// Read-only LevelDB reader with built-in Snappy, so Chrome's Local Storage can be read without a
// native module. It reads the tables the MANIFEST lists as live plus the current write-ahead log,
// and keeps the newest version of each key. It takes no lock: reading the directory while Chrome
// compacts it can fail, so readLevelDb retries, and callers can still read from a copy.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Entry = [key: Buffer, value: Buffer];

class Reader {
  constructor(
    readonly buf: Buffer,
    public pos = 0,
  ) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  byte(): number {
    if (this.pos >= this.buf.length) throw new Error("leveldb: truncated data");
    return this.buf[this.pos++];
  }

  // Up to 64-bit varint; exact while the value stays below 2^53, which file numbers and sizes do.
  varint(): number {
    let result = 0;
    for (let mul = 1; ; mul *= 128) {
      const b = this.byte();
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      if (mul > 2 ** 56) throw new Error("leveldb: varint too long");
    }
  }

  bytes(n: number): Buffer {
    if (this.pos + n > this.buf.length) throw new Error("leveldb: truncated data");
    return this.buf.subarray(this.pos, (this.pos += n));
  }

  slice(): Buffer {
    return this.bytes(this.varint());
  }
}

// CRC-32C (Castagnoli). LevelDB stores it "masked" so CRCs of data containing CRCs stay distinct.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32c(...parts: Buffer[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function unmaskCrc(masked: number): number {
  const rot = (masked - 0xa282ead8) >>> 0;
  return ((rot << 15) | (rot >>> 17)) >>> 0;
}

/** Decompress a raw (unframed) Snappy buffer. */
export function snappyUncompress(src: Buffer): Buffer {
  const r = new Reader(src);
  const length = r.varint();
  const out = Buffer.allocUnsafe(length);
  let o = 0;
  let p = r.pos;
  while (p < src.length) {
    const tag = src[p++];
    let len: number;
    let offset: number;
    switch (tag & 3) {
      case 0: {
        len = tag >>> 2;
        if (len >= 60) {
          const extra = len - 59;
          len = src.readUIntLE(p, extra);
          p += extra;
        }
        len += 1;
        if (p + len > src.length || o + len > length) throw new Error("snappy: literal out of range");
        src.copy(out, o, p, p + len);
        o += len;
        p += len;
        continue;
      }
      case 1:
        len = ((tag >>> 2) & 7) + 4;
        offset = ((tag >>> 5) << 8) | src[p++];
        break;
      case 2:
        len = (tag >>> 2) + 1;
        offset = src.readUInt16LE(p);
        p += 2;
        break;
      default:
        len = (tag >>> 2) + 1;
        offset = src.readUInt32LE(p);
        p += 4;
    }
    if (offset === 0 || offset > o || o + len > length) throw new Error("snappy: copy out of range");
    // Copies may overlap their own output (a run), so go byte by byte.
    for (const end = o + len; o < end; o++) out[o] = out[o - offset];
  }
  if (o !== length) throw new Error("snappy: length mismatch");
  return out;
}

// ---- Tables (.ldb / .sst) ----

const TABLE_MAGIC = 0xdb4775248b80fb57n;

// Reads the block a BlockHandle (offset, size varints) at `handle` points to, checks its CRC and
// decompresses it. Each block is followed by a 1-byte compression type and a 4-byte masked CRC.
function readBlock(file: Buffer, handle: Reader): Buffer {
  const offset = handle.varint();
  const size = handle.varint();
  const end = offset + size;
  if (end + 5 > file.length) throw new Error("leveldb: block out of range");
  const data = file.subarray(offset, end);
  const type = file.subarray(end, end + 1);
  if (crc32c(data, type) !== unmaskCrc(file.readUInt32LE(end + 1))) throw new Error("leveldb: block checksum mismatch");
  if (type[0] === 0) return data;
  if (type[0] === 1) return snappyUncompress(data);
  throw new Error(`leveldb: unsupported block compression ${type[0]}`);
}

// Entries of one block: prefix-compressed keys, then a restart array we don't need for a full scan.
function* blockEntries(block: Buffer): Generator<Entry> {
  const restarts = block.readUInt32LE(block.length - 4);
  const r = new Reader(block.subarray(0, block.length - 4 - 4 * restarts));
  let key = Buffer.alloc(0);
  while (!r.done) {
    const shared = r.varint();
    const nonShared = r.varint();
    const valueLength = r.varint();
    key = Buffer.concat([key.subarray(0, shared), r.bytes(nonShared)]);
    yield [key, r.bytes(valueLength)];
  }
}

// Every internal key/value in a table, in order. The 48-byte footer holds the metaindex and index
// handles and ends with the magic number; the index maps each data block's last key to its handle.
function* tableEntries(file: Buffer): Generator<Entry> {
  if (file.length < 48 || file.readBigUInt64LE(file.length - 8) !== TABLE_MAGIC) throw new Error("leveldb: not a table");
  const footer = new Reader(file.subarray(file.length - 48));
  footer.varint(); // metaindex offset
  footer.varint(); // metaindex size
  const index = readBlock(file, footer);
  for (const [, handle] of blockEntries(index)) yield* blockEntries(readBlock(file, new Reader(handle)));
}

// ---- Log files (.log, MANIFEST) ----

const LOG_BLOCK = 32768;
const LOG_HEADER = 7; // crc (4), length (2), type (1)

// Records of a log file, reassembled from FULL / FIRST / MIDDLE / LAST fragments. A torn or
// corrupt fragment drops the rest of its 32 KiB block, as LevelDB's own recovery does.
function* logRecords(file: Buffer): Generator<Buffer> {
  let parts: Buffer[] | null = null;
  let pos = 0;
  while (pos + LOG_HEADER <= file.length) {
    const left = LOG_BLOCK - (pos % LOG_BLOCK);
    if (left < LOG_HEADER) {
      pos += left; // block trailer padding
      continue;
    }
    const length = file.readUInt16LE(pos + 4);
    const type = file[pos + 6];
    const start = pos + LOG_HEADER;
    const end = start + length;
    if (type === 0 && length === 0) {
      pos += left; // zero-filled (preallocated) space
      continue;
    }
    if (end > file.length) break; // write in progress
    const data = file.subarray(start, end);
    if (length > left - LOG_HEADER || crc32c(file.subarray(pos + 6, start), data) !== unmaskCrc(file.readUInt32LE(pos))) {
      parts = null;
      pos += left;
      continue;
    }
    pos = end;
    switch (type) {
      case 1: // FULL
        parts = null;
        yield data;
        break;
      case 2: // FIRST
        parts = [data];
        break;
      case 3: // MIDDLE
        parts?.push(data);
        break;
      case 4: // LAST
        if (parts) yield Buffer.concat([...parts, data]);
        parts = null;
        break;
      default:
        parts = null;
    }
  }
}

// A write batch: 8-byte sequence, 4-byte count, then count records of tag 1 (put key, value) or
// tag 0 (delete key). Record i gets sequence + i.
function applyBatch(batch: Buffer, put: (key: Buffer, seq: number, value: Buffer | null) => void): void {
  if (batch.length < 12) throw new Error("leveldb: short write batch");
  const seq = Number(batch.readBigUInt64LE(0));
  const count = batch.readUInt32LE(8);
  const r = new Reader(batch, 12);
  for (let i = 0; i < count; i++) {
    const tag = r.byte();
    const key = r.slice();
    if (tag === 1) put(key, seq + i, r.slice());
    else if (tag === 0) put(key, seq + i, null);
    else throw new Error(`leveldb: bad write batch tag ${tag}`);
  }
}

// ---- Manifest ----

interface LiveFiles {
  tables: number[];
  logNumber: number;
  prevLogNumber: number;
}

// Replays the version edits in the current MANIFEST to find the live table files and the oldest
// log that still holds unflushed writes.
function liveFiles(dir: string): LiveFiles {
  const current = readFileSync(join(dir, "CURRENT"), "latin1").trim();
  if (!/^MANIFEST-\d+$/.test(current)) throw new Error(`leveldb: bad CURRENT file "${current}"`);
  const tables = new Set<number>();
  let logNumber = 0;
  let prevLogNumber = 0;
  for (const edit of logRecords(readFileSync(join(dir, current)))) {
    const r = new Reader(edit);
    while (!r.done) {
      const tag = r.varint();
      switch (tag) {
        case 1: // comparator name
          r.slice();
          break;
        case 2:
          logNumber = r.varint();
          break;
        case 3: // next file number
        case 4: // last sequence
          r.varint();
          break;
        case 5: // compact pointer: level, internal key
          r.varint();
          r.slice();
          break;
        case 6: // deleted file: level, number
          r.varint();
          tables.delete(r.varint());
          break;
        case 7: // new file: level, number, size, smallest, largest
          r.varint();
          tables.add(r.varint());
          r.varint();
          r.slice();
          r.slice();
          break;
        case 9:
          prevLogNumber = r.varint();
          break;
        default:
          throw new Error(`leveldb: unknown manifest tag ${tag}`);
      }
    }
  }
  return { tables: [...tables], logNumber, prevLogNumber };
}

function readTableFile(dir: string, number: number): Buffer {
  const base = join(dir, String(number).padStart(6, "0"));
  try {
    return readFileSync(`${base}.ldb`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return readFileSync(`${base}.sst`);
  }
}

function readOnce(dir: string, prefix: Buffer): Entry[] {
  const { tables, logNumber, prevLogNumber } = liveFiles(dir);
  const newest = new Map<string, { seq: number; key: Buffer; value: Buffer | null }>();
  const put = (key: Buffer, seq: number, value: Buffer | null) => {
    if (key.length < prefix.length || prefix.compare(key, 0, prefix.length) !== 0) return;
    const id = key.toString("latin1");
    const seen = newest.get(id);
    if (!seen || seen.seq < seq) newest.set(id, { seq, key, value });
  };

  for (const number of tables) {
    for (const [internalKey, value] of tableEntries(readTableFile(dir, number))) {
      // Internal key = user key + 8-byte trailer of (sequence << 8 | type), type 1 = value, 0 = deletion.
      const split = internalKey.length - 8;
      const trailer = internalKey.readBigUInt64LE(split);
      put(internalKey.subarray(0, split), Number(trailer >> 8n), trailer & 0xffn ? value : null);
    }
  }

  for (const name of readdirSync(dir)) {
    const m = /^(\d+)\.log$/.exec(name);
    if (!m) continue;
    const number = Number(m[1]);
    if (number < logNumber && number !== prevLogNumber) continue;
    for (const batch of logRecords(readFileSync(join(dir, name)))) applyBatch(batch, put);
  }

  const out: Entry[] = [];
  for (const { key, value } of newest.values()) if (value) out.push([key, value]);
  return out.sort((a, b) => Buffer.compare(a[0], b[0]));
}

/**
 * Live key/value pairs of the LevelDB at `dir`, sorted by key (bytewise), optionally only those
 * whose key starts with `prefix`. Retries if a compaction removes a file mid-read.
 */
export function readLevelDb(dir: string, prefix: Buffer = Buffer.alloc(0)): Entry[] {
  for (let attempt = 1; ; attempt++) {
    try {
      return readOnce(dir, prefix);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT" || attempt >= 3) throw e;
    }
  }
}
