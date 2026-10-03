import { launchPersistentContext } from "cloakbrowser";
import { readChromeCookies } from "./dist/chrome-cookies.js";
import { mkdtempSync, rmSync } from "node:fs";
for (const [label, sites] of [["seek-only", ["seek.com","seek.co.nz"]], ["all-cookies", []]]) {
  const dir = mkdtempSync("/tmp/seekprof-");
  const ctx = await launchPersistentContext({ userDataDir: dir, headless: true, locale: "en-NZ", timezone: "Pacific/Auckland" });
  const ck = readChromeCookies(sites); await ctx.addCookies(ck);
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto("https://nz.seek.com/my-activity/saved-jobs", { waitUntil: "domcontentloaded" }).catch(()=>{});
  await page.waitForTimeout(9000);
  console.log(label.padEnd(12), ck.length, "cookies ->", page.url().slice(0, 80));
  await ctx.close(); rmSync(dir, { recursive: true, force: true });
}
