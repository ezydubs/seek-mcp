import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse, print, visit } from "graphql";

const [sp, ...apps] = process.argv.slice(2);
const ops = new Map();
const frags = new Map();

function addDoc(text, app) {
  let doc;
  try { doc = parse(text, { noLocation: true }); } catch { return false; }
  for (const d of doc.definitions) {
    if (d.kind === "FragmentDefinition") { if (!frags.has(d.name.value)) frags.set(d.name.value, d); }
    else if (d.kind === "OperationDefinition" && d.name) {
      const cur = ops.get(d.name.value);
      if (cur) { cur.apps.add(app); if (print(d).length > print(cur.def).length) cur.def = d; }
      else ops.set(d.name.value, { type: d.operation, apps: new Set([app]), def: d });
    }
  }
  return true;
}

function stringsWithGraphql(src) {
  const out = [];
  const re = /(?:query|mutation|subscription)\s+[A-Za-z_]\w*\s*[({]|fragment\s+[A-Za-z_]\w*\s+on\s+[A-Za-z_]\w*/g;
  let m;
  let lastEnd = -1;
  while ((m = re.exec(src))) {
    if (m.index < lastEnd) continue;
    let s = m.index - 1;
    while (s >= 0 && !(`"'\``.includes(src[s]) && src[s - 1] !== "\\")) s--;
    if (s < 0) continue;
    const q = src[s];
    let i = s + 1;
    let text = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") {
        const n = src[i + 1];
        if (n === "n") text += "\n"; else if (n === "t") text += "\t"; else if (n === "u") { text += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 4; } else text += n;
        i += 2; continue;
      }
      if (q === "`" && src[i] === "$" && src[i + 1] === "{") {
        let depth = 1; i += 2; const st = i;
        while (i < src.length && depth) { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; i++; }
        const expr = src.slice(st, i - 1).trim();
        text += /^-?\d+(\.\d+)?$/.test(expr) ? expr : /^"[^"]*"$/.test(expr) ? expr : /^!0$/.test(expr) ? "true" : /^!1$/.test(expr) ? "false" : "\n"; continue;
      }
      text += src[i++];
    }
    lastEnd = i;
    out.push(text);
  }
  return out;
}

for (const app of apps) {
  const j = join(sp, `${app}-ops.json`);
  if (existsSync(j)) for (const d of JSON.parse(readFileSync(j, "utf8"))) if (d.text && !d.text.startsWith("/*")) addDoc(d.text, app);
  const dir = join(sp, "bundles", app);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const src = readFileSync(join(dir, f), "utf8");
    for (const s of stringsWithGraphql(src)) {
      if (!addDoc(s, app)) {
        for (const piece of s.split(/(?=\b(?:query|mutation|fragment)\s+[A-Za-z_]\w*)/)) addDoc(piece, app);
      }
    }
  }
}

function withFragments(def) {
  const need = new Set();
  const stack = [def];
  const seen = new Set();
  while (stack.length) {
    const d = stack.pop();
    visit(d, { FragmentSpread(n) { const name = n.name.value; if (!seen.has(name)) { seen.add(name); need.add(name); const f = frags.get(name); if (f) stack.push(f); } } });
  }
  const missing = [...need].filter((n) => !frags.has(n));
  const text = [print(def), ...[...need].filter((n) => frags.has(n)).map((n) => print(frags.get(n)))].join("\n\n");
  return { text, missing };
}

const catalog = {};
for (const [name, o] of [...ops].sort((a, b) => a[0].localeCompare(b[0]))) {
  const { text, missing } = withFragments(o.def);
  catalog[name] = {
    type: o.type,
    apps: [...o.apps],
    variables: (o.def.variableDefinitions ?? []).map((v) => `$${v.variable.name.value}: ${print(v.type)}`),
    missingFragments: missing.length ? missing : undefined,
    text,
  };
}
writeFileSync(join(sp, "catalog.json"), JSON.stringify(catalog, null, 1));
const byApp = {};
for (const [n, o] of Object.entries(catalog)) for (const a of o.apps) (byApp[a] ??= []).push(`${o.type === "mutation" ? "M " : ""}${n}`);
console.log(`${Object.keys(catalog).length} operations, ${frags.size} fragments`);
for (const [a, list] of Object.entries(byApp)) console.log(`\n[${a}] ${list.length}: ${list.join(", ")}`);
const miss = Object.entries(catalog).filter(([, o]) => o.missingFragments).map(([n, o]) => `${n}(${o.missingFragments})`);
if (miss.length) console.log(`\nmissing fragments: ${miss.join("; ")}`);
