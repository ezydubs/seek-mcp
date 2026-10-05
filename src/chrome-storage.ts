import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readLevelDb } from "./leveldb.js";

function decode(b: Buffer): string {
  if (b[0] === 1) return b.subarray(1).toString("latin1");
  if (b[0] === 0) return b.subarray(1).toString("utf16le");
  return b.toString("utf8");
}

export async function readChromeLocalStorage(
  origin: string,
  keyPrefix = "",
  profile = process.env.CHROME_PROFILE ?? "Default",
): Promise<Record<string, string>> {
  const source = join(homedir(), "Library/Application Support/Google/Chrome", profile, "Local Storage", "leveldb");
  const dir = mkdtempSync(join(tmpdir(), "chrome-ls-"));
  try {
    cpSync(source, dir, { recursive: true });

    const prefix = Buffer.from(`_${origin}\x00`, "latin1");
    const out: Record<string, string> = {};
    for (const [k, v] of readLevelDb(dir, prefix)) {
      const name = decode(k.subarray(prefix.length));
      if (name.startsWith(keyPrefix)) out[name] = decode(v);
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
