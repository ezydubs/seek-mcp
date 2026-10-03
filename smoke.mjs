// Live smoke test: drive the built server over MCP stdio like Claude Code does.
import { spawn } from "node:child_process";
const p = spawn(process.execPath, ["dist/server.js"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "", id = 0; const waiting = new Map();
p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
const call = (method, params) => new Promise((res) => { const n = ++id; waiting.set(n, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n"); });
const tool = async (name, args = {}) => { const t = Date.now(); const r = await call("tools/call", { name, arguments: args }); console.log(`\n== ${name} (${((Date.now() - t) / 1000).toFixed(1)}s) error=${!!r.result.isError}`); return r.result.content[0].text; };
await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
console.log("tools:", (await call("tools/list", {})).result.tools.map((t) => t.name).join(", "));
const s = JSON.parse(await tool("seek_search", { keywords: "software engineer", where: "All Auckland", pageSize: 2 }));
console.log("search total", s.total);
for (const name of ["seek_saved_jobs", "seek_applied_jobs"]) {
  const out = await tool(name);
  try { const a = JSON.parse(out); console.log(`${a.length} jobs`); for (const x of a.slice(0, 4)) console.log(" -", x.title, "@", x.company, x.status ? `[${x.status}]` : "", x.savedAt ?? x.appliedAt ?? ""); }
  catch { console.log(out.slice(0, 300)); }
}
p.kill("SIGTERM");
