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
  const t = Date.now();
  const r = await call("tools/call", { name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 300); }
  console.log(`\n### ${name} ${JSON.stringify(args)} — ${Date.now() - t}ms isError=${!!r.isError}`);
  console.log(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 1).slice(0, 1200));
  return parsed;
};

await call("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

console.log("tools:", (await call("tools/list", {})).tools.map((t) => t.name).join(", "));
await tool("seek_auth");
const s = await tool("seek_search", { keywords: "python developer", where: "All Auckland", pageSize: 3, sort: "newest" });
const first = s?.jobs?.find((j) => !j.promoted) ?? s?.jobs?.[0];
if (first) {
  await tool("seek_job", { id: first.id });
  await tool("seek_apply_requirements", { id: first.id });
}
await tool("seek_profile");
await tool("seek_saved_jobs");
await tool("seek_applied_jobs");

if (first) {
  await tool("seek_save_job", { id: first.id });
  const savedNow = await tool("seek_saved_jobs");
  console.log("saved list contains it:", Array.isArray(savedNow) && savedNow.some((j) => j.id === first.id));
  await tool("seek_unsave_job", { id: first.id });
}

const CV = process.env.SEEK_CV_PATH;
if (CV) {
  const up = await tool("seek_resume_upload", { path: CV, makeDefault: false });
  if (up?.resume?.id) await tool("seek_resume_delete", { id: up.resume.id });
  await tool("seek_cv_read", { path: CV });
} else console.log("\n(set SEEK_CV_PATH to exercise seek_cv_read and résumé upload → delete)");

await tool("seek_auth", { check: true });
await tool("seek_profile", { sections: ["all"] });
await tool("seek_preferences");
await tool("seek_skills");
await tool("seek_notifications");
await tool("seek_saved_searches");
await tool("seek_recommended_jobs");
await tool("seek_job_feedback");
await tool("seek_application", { action: "credits" });
if (first) {
  await tool("seek_job_insights", { id: first.id });
  await tool("seek_save_job", { id: first.id });
  await tool("seek_job_note", { id: first.id, list: "saved", note: "seek-mcp smoke test note" });
  const withNote = await tool("seek_saved_jobs");
  console.log("note stored:", Array.isArray(withNote) && withNote.some((j) => j.id === first.id && j.notes));
  await tool("seek_job_note", { id: first.id, list: "saved", note: null });
  await tool("seek_unsave_job", { id: first.id });
}
const created = await tool("seek_saved_searches", { action: "create", keywords: "seek-mcp smoke test", where: "All Auckland" });
if (created?.search?.id) {
  await tool("seek_saved_searches", { action: "alerts", id: created.search.id, emailAlerts: false });
  await tool("seek_saved_searches", { action: "delete", id: created.search.id });
}
const applied = await tool("seek_applied_jobs");
if (Array.isArray(applied) && applied[0]) await tool("seek_application", { id: applied[0].id });

const withQs = await tool("seek_search", { keywords: "office administrator", where: "All Auckland", pageSize: 8, sort: "newest" });
for (const cand of (withQs?.jobs ?? []).filter((j) => !j.promoted)) {
  const req = await tool("seek_apply_requirements", { id: cand.id });
  const internal = (req?.questions?.length ?? 0) > 0 && !req.externalApply;
  if (!internal) continue;
  console.log(`\n### dry-run apply on ${cand.id} (${req.questions.length} questions, selectionCriteriaRequired=${req.selectionCriteriaRequired})`);

  const answers = req.questions.map((q) =>
    q.options?.length
      ? { question: q.text.slice(0, 28), option: q.options[Math.min(3, q.options.length - 1)].text }
      : { question: q.text.slice(0, 28), text: "45" },
  );
  console.log("answers:", JSON.stringify(answers, null, 1));
  await tool("seek_apply", { id: cand.id, answers, submit: false });
  break;
}

const ext = (withQs?.jobs ?? []).find((j) => j.promoted);
if (ext) await tool("seek_apply", { id: ext.id, submit: false });
p.kill("SIGTERM");
