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

await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "submit", version: "0" } });
p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const jobId = process.argv[2];
const rate = process.argv[3];
const consent = process.argv[4] === "yes";

const sa = await tool("seek_standing_answers", { salaryHourly: rate });
console.log("standing answers now:", JSON.stringify(sa.parsed.answers?.salary, null, 1));

const answers = consent ? [{ question: "Do you agree with the privacy policy", option: "Yes" }] : [];

const dry = await tool("seek_apply", { id: jobId, submit: false, answers });
if (dry.isError) {
  console.log("\nDRY RUN FAILED — not submitting:");
  console.log(JSON.stringify(dry.parsed.raw ?? dry.parsed, null, 1).slice(0, 1500));
  p.kill("SIGTERM");
  process.exit(1);
}
console.log("\n--- dry run OK, payload: ---");
console.log(JSON.stringify(dry.parsed, null, 1));

console.log("\n--- SUBMITTING ---");
const res = await tool("seek_apply", { id: jobId, submit: true, answers });
console.log("isError:", res.isError);
console.log(JSON.stringify(res.parsed, null, 1).slice(0, 1200));

const applied = await tool("seek_applied_jobs");
const rows = Array.isArray(applied.parsed) ? applied.parsed : [];
const hit = rows.find((r) => r.id === jobId);
console.log(`\nseek_applied_jobs: ${rows.length} entries; ${jobId} present: ${!!hit}`);
if (hit) console.log(JSON.stringify({ id: hit.id, title: hit.title, company: hit.company, appliedAt: hit.appliedAt, status: hit.status, withResume: hit.withResume, withCoverLetter: hit.withCoverLetter }, null, 1));

p.kill("SIGTERM");