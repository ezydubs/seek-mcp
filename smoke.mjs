// Live smoke test: drive the built server over MCP stdio like Claude Code does.
import { spawn } from "node:child_process";
const p = spawn(process.execPath, ["dist/server.js"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "", id = 0; const waiting = new Map();
p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
const call = (method, params) => new Promise((res) => { const n = ++id; waiting.set(n, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n"); });
const tool = async (name, args = {}) => { const t = Date.now(); const r = await call("tools/call", { name, arguments: args }); const text = r.result.content[0].text; console.log(`\n== ${name} ${JSON.stringify(args)} (${((Date.now()-t)/1000).toFixed(1)}s) error=${!!r.result.isError}`); return text; };
await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
console.log("tools:", (await call("tools/list", {})).result.tools.map((t) => t.name).join(", "));
const s = JSON.parse(await tool("seek_search", { keywords: "software engineer", where: "All Auckland", pageSize: 3, sort: "newest" }));
console.log("total", s.total); for (const j of s.jobs) console.log(" -", j.id, j.title, "|", j.company, "|", j.location, "|", j.salary, "|", j.listedAgo);
const j = JSON.parse(await tool("seek_job", { id: s.jobs[0].id }));
console.log(j.title, "|", j.company, "|", j.location, "|", j.workType, "|", j.status, "| desc chars:", j.description.length); console.log(j.description.slice(0, 300));


p.kill("SIGTERM");
