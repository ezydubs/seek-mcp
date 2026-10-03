// Read the user's own Google Chrome cookies for chosen sites, decrypted, in Playwright's shape.
// Chrome's profile can't be handed to CloakBrowser (it is locked while Chrome runs and its cookies
// are encrypted with the "Chrome Safe Storage" Keychain key that Chromium builds can't read),
// so we decrypt here and add them to the CloakBrowser profile instead.
import { execFileSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

interface Row {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Uint8Array;
  path: string;
  expires_utc: bigint;
  is_secure: bigint;
  is_httponly: bigint;
  samesite: bigint;
}

// Chrome stores times as microseconds since 1601-01-01.
const WINDOWS_EPOCH_OFFSET_S = 11644473600;

function chromeKey(): Buffer {
  const password = execFileSync("security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage"], {
    encoding: "utf8",
  }).trim();
  return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

function decrypt(encrypted: Buffer, key: Buffer, dbVersion: number): string {
  const prefix = encrypted.subarray(0, 3).toString("latin1");
  if (prefix !== "v10") return encrypted.toString("utf8");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  // From cookie DB version 24, Chrome prepends SHA-256(host_key) to the plaintext.
  if (dbVersion >= 24) plain = plain.subarray(32);
  return plain.toString("utf8");
}

const SAME_SITE: Record<number, PlaywrightCookie["sameSite"]> = { 0: "None", 1: "Lax", 2: "Strict" };

/** Cookies whose host ends with one of `sites` (e.g. "seek.com"); an empty list means every cookie. */
export function readChromeCookies(sites: string[], profile = process.env.CHROME_PROFILE ?? "Default"): PlaywrightCookie[] {
  const source = join(homedir(), "Library/Application Support/Google/Chrome", profile, "Cookies");
  const dir = mkdtempSync(join(tmpdir(), "chrome-cookies-"));
  const copy = join(dir, "Cookies");
  try {
    copyFileSync(source, copy); // Chrome holds the live DB open; read a snapshot.
    const db = new DatabaseSync(copy, { readOnly: true });
    const dbVersion = Number((db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string }).value);
    const stmt = db.prepare(
      "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies",
    );
    stmt.setReadBigInts(true); // expires_utc is microseconds since 1601, beyond Number's safe range
    const rows = stmt.all() as unknown as Row[];
    db.close();

    const key = chromeKey();
    const now = Date.now() / 1000;
    const wanted = (host: string) => {
      const h = host.replace(/^\./, "");
      return sites.length === 0 || sites.some((s) => h === s || h.endsWith(`.${s}`));
    };
    const out: PlaywrightCookie[] = [];
    for (const r of rows) {
      if (!wanted(r.host_key)) continue;
      const expiresUs = BigInt(r.expires_utc);
      const expires = expiresUs > 0n ? Number(expiresUs / 1_000_000n) - WINDOWS_EPOCH_OFFSET_S : -1;
      if (expires !== -1 && expires < now) continue;
      const value = r.value || decrypt(Buffer.from(r.encrypted_value), key, dbVersion);
      const sameSite = SAME_SITE[Number(r.samesite)] ?? "Lax";
      out.push({
        name: r.name,
        value,
        domain: r.host_key,
        path: r.path || "/",
        expires,
        httpOnly: Number(r.is_httponly) === 1,
        // Chromium refuses SameSite=None without Secure.
        secure: Number(r.is_secure) === 1 || sameSite === "None",
        sameSite,
      });
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
