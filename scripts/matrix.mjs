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

await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "matrix", version: "0" } });
p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const keywords = process.argv[2] ?? "office administrator";

const extra = process.argv.slice(3).map((a) => {
  const [question, field, value] = a.split("::");
  return field === "text" ? { question, text: value } : { question, option: value };
});

const s = await tool("seek_search", { keywords, where: "All Auckland", pageSize: 10, sort: "newest" });
const rows = [];
for (const j of s.parsed.jobs ?? []) {
  const req = await tool("seek_apply_requirements", { id: j.id });
  const q = req.parsed;
  if (q.externalApply) { rows.push({ id: j.id, title: j.title, verdict: "external — refused", why: "advertiser takes applications off Seek" }); continue; }

  const { parsed: res, isError } = await tool("seek_apply", { id: j.id, submit: false, answers: extra });
  if (isError) {
    rows.push({ id: j.id, title: j.title, verdict: "FAIL", why: String(res.raw ?? "").split("\n").slice(0, 6).join(" / ") });
  } else {
    const af = (res.autoFilled ?? []).map((a) => `${a.question.slice(0, 22)}=${a.answer}`).join(", ");
    rows.push({ id: j.id, title: j.title, verdict: "OK", why: `prepared; auto-filled: ${af || "none"}` });
  }
}

console.log(`\n=== auto-apply matrix for "${keywords}"${extra.length ? ` (+${extra.length} extra answers)` : " (standing answers only)"} ===`);
for (const r of rows) {
  console.log(`\n[${r.verdict.padEnd(18)}] ${r.id} ${r.title.slice(0, 40)}`);
  console.log(`   ${r.why}`);
}
const ok = rows.filter((r) => r.verdict === "OK").length;
console.log(`\nsummary: ${ok}/${rows.length} would apply, ${rows.filter((r) => r.verdict === "FAIL").length} fail, ${rows.filter((r) => r.verdict.startsWith("external")).length} external`);

p.kill("SIGTERM");