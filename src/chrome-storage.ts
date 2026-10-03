// Read localStorage entries for one origin from the user's own Google Chrome profile.
// Chrome keeps localStorage in a LevelDB it holds open, so we read a copy. Values are not encrypted.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ClassicLevel } from "classic-level";

// Chrome encodes localStorage strings with a one-byte tag: 0 = UTF-16LE, 1 = Latin-1.
function decode(b: Buffer): string {
  if (b[0] === 1) return b.subarray(1).toString("latin1");
  if (b[0] === 0) return b.subarray(1).toString("utf16le");
  return b.toString("utf8");
}

/** localStorage entries of `origin` (e.g. "https://nz.seek.com") whose key starts with `keyPrefix`. */
export async function readChromeLocalStorage(
  origin: string,
  keyPrefix = "",
  profile = process.env.CHROME_PROFILE ?? "Default",
): Promise<Record<string, string>> {
  const source = join(homedir(), "Library/Application Support/Google/Chrome", profile, "Local Storage", "leveldb");
  const dir = mkdtempSync(join(tmpdir(), "chrome-ls-"));
  try {
    cpSync(source, dir, { recursive: true });
    rmSync(join(dir, "LOCK"), { force: true });
    const db = new ClassicLevel<Buffer, Buffer>(dir, { keyEncoding: "buffer", valueEncoding: "buffer" });
    // Keys look like "_<origin>\0<tag><name>".
    const prefix = Buffer.from(`_${origin}\x00`, "latin1");
    const out: Record<string, string> = {};
    try {
      for await (const [k, v] of db.iterator({ gte: prefix, lt: Buffer.concat([prefix, Buffer.from([0xff])]) })) {
        const name = decode(k.subarray(prefix.length));
        if (name.startsWith(keyPrefix)) out[name] = decode(v);
      }
    } finally {
      await db.close();
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
