import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const [outDir, origin, ...entries] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

async function get(path) {
  const file = join(outDir, basename(path.split("?")[0]));
  if (existsSync(file)) return null;
  const r = await fetch(new URL(path, origin), { headers: { "user-agent": UA } });
  if (!r.ok) { console.log(`HTTP ${r.status} ${path}`); return null; }
  const text = await r.text();
  writeFileSync(file, text);
  return text;
}

const runtimePath = entries[0];
const base = dirname(runtimePath) + "/";
const runtime = await get(runtimePath);
for (const e of entries.slice(1)) await get(e);

const maps = [...(runtime ?? "").matchAll(/\(\{([^{}]*)\}\)\[e\]/g)].map((m) =>
  Object.fromEntries([...m[1].matchAll(/(\d+):"([^"]+)"/g)].map((x) => [x[1], x[2]])),
);
const chunks = new Set();
if (maps.length >= 2) {
  const [names, hashes] = maps;
  for (const id of Object.keys(hashes)) chunks.add(`${names[id] ?? id}-${hashes[id]}.js`);
} else if (maps.length === 1) {
  for (const [id, h] of Object.entries(maps[0])) chunks.add(`${id}-${h}.js`);
}
for (const m of (runtime ?? "").matchAll(/\{((?:\d+:"[0-9a-f]{16,}",?)+)\}\[e\]/g)) {
  for (const x of m[1].matchAll(/(\d+):"([0-9a-f]+)"/g)) chunks.add(`${x[1]}-${x[2]}.js`);
}
let n = 0;
for (const c of chunks) {
  if (/translations/.test(c) && !/^(en|en-NZ)-translations/.test(c)) continue;
  if ((await get(base + c)) !== null) n++;
}
console.log(`${outDir}: runtime maps=${maps.length}, chunks listed=${chunks.size}, fetched=${n}`);
