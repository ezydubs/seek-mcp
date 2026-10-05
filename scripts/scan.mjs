import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/server.js", import.meta.url));

const p = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const waiters = new Map();
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  }
});
let id = 0;
const call = (method, params) =>
  new Promise((res, rej) => {
    const n = ++id;
    waiters.set(n, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: n, method, params })}\n`);
  });

const tool = async (name, args = {}) => {
  const r = await call("tools/call", { name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { parsed, isError: !!r.isError };
};

await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "scan", version: "0" } });
p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const searches = process.argv.slice(2).length ? process.argv.slice(2) : [
  "python developer", "software engineer", "data analyst", "administrator",
  "accountant", "project manager", "business analyst", "IT support",
];
const seen = new Set();
const ready = [];
const blocked = new Map();

for (const kw of searches) {
  const s = await tool("seek_search", { keywords: kw, where: "All Auckland", pageSize: 12, sort: "newest" });
  for (const j of s.parsed.jobs ?? []) {
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    const req = await tool("seek_apply_requirements", { id: j.id });
    if (req.parsed.externalApply) continue;

    const dry = await tool("seek_apply", { id: j.id, submit: false });
    if (!dry.isError) { ready.push({ id: j.id, ...j }); continue; }
    const msg = String(dry.parsed.raw ?? "");
    for (const m of msg.matchAll(/no answer given for: (.+?)(?:\n|$)/g)) {
      for (const q of m[1].split("|").map((x) => x.trim()).filter(Boolean)) {
        const k = q.replace(/'s|'|\?/g, "").replace(/\s+/g, " ").trim().toLowerCase();
        blocked.set(k, (blocked.get(k) ?? 0) + 1);
      }
    }
  }
}

console.log(`\n=== ${ready.length} of ${seen.size} jobs complete from standing answers alone ===`);
for (const r of ready) console.log(`  ${r.id}  ${r.title.slice(0, 44).padEnd(44)} ${r.company.slice(0, 26)}`);

console.log(`\n=== most common unanswered questions ===`);
[...blocked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  .forEach(([q, n]) => console.log(`  ${String(n).padStart(3)}x  ${q}`));

p.kill("SIGTERM");