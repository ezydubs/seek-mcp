import { readFileSync, writeFileSync } from "node:fs";
import { buildClientSchema, printSchema } from "graphql";

const [outDir, ...files] = process.argv.slice(2);
let best = null;
for (const f of files) {
  const s = readFileSync(f, "utf8");
  const at = s.indexOf(`JSON.parse('{"__schema"`);
  if (at < 0) continue;
  let i = at + "JSON.parse('".length;
  let text = "";
  while (i < s.length && s[i] !== "'") {
    if (s[i] === "\\") {
      const n = s[i + 1];
      if (n === "u") { text += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)); i += 6; continue; }
      if (n === "x") { text += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16)); i += 4; continue; }
      text += { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", 0: "\0" }[n] ?? n;
      i += 2;
      continue;
    }
    text += s[i++];
  }
  const json = JSON.parse(text);
  const types = json.__schema.types.length;
  console.log(`${f}: ${types} types`);
  if (!best || types > best.types) best = { json, types, f };
}
if (!best) throw new Error("no embedded schema found");
const schema = buildClientSchema(best.json);
writeFileSync(`${outDir}/schema.json`, JSON.stringify(best.json));
writeFileSync(`${outDir}/schema.graphql`, printSchema(schema));
console.log(`saved ${best.types} types from ${best.f}`);
