import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { print } from "graphql";

class Bail extends Error {}

function parseLiteral(src, start) {
  let i = start;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const value = () => {
    ws();
    const c = src[i];
    if (c === "{") return obj();
    if (c === "[") return arr();
    if (c === '"' || c === "'" || c === "`") return str();
    if (src.startsWith("!0", i)) { i += 2; return true; }
    if (src.startsWith("!1", i)) { i += 2; return false; }
    if (src.startsWith("void 0", i)) { i += 6; return undefined; }
    const num = /^-?\d+(\.\d+)?(e[+-]?\d+)?/i.exec(src.slice(i, i + 40));
    if (num) { i += num[0].length; return Number(num[0]); }
    const id = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*/.exec(src.slice(i, i + 200));
    if (id) {
      i += id[0].length;
      if (id[0] === "true") return true;
      if (id[0] === "false") return false;
      if (id[0] === "null") return null;
      return { $ref: id[0] };
    }
    throw new Bail(`unexpected ${JSON.stringify(src.slice(i, i + 30))}`);
  };
  const str = () => {
    const q = src[i++];
    let out = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") {
        const n = src[i + 1];
        const map = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
        if (n === "u") { out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 6; continue; }
        if (n === "x") { out += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16)); i += 4; continue; }
        out += map[n] ?? n; i += 2; continue;
      }
      out += src[i++];
    }
    i++;
    return out;
  };
  const key = () => {
    ws();
    if (src[i] === '"' || src[i] === "'") return str();
    const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 100));
    if (!m) throw new Bail(`bad key at ${JSON.stringify(src.slice(i, i + 30))}`);
    i += m[0].length;
    return m[0];
  };
  const obj = () => {
    i++;
    const o = {};
    ws();
    if (src[i] === "}") { i++; return o; }
    for (;;) {
      ws();
      if (src.startsWith("...", i)) { i += 3; const v = value(); (o.$spread ??= []).push(v); }
      else {
        const k = key();
        ws();
        if (src[i] !== ":") throw new Bail(`expected : after ${k}`);
        i++;
        o[k] = value();
      }
      ws();
      if (src[i] === ",") { i++; continue; }
      if (src[i] === "}") { i++; return o; }
      throw new Bail(`expected , or } at ${JSON.stringify(src.slice(i, i + 30))}`);
    }
  };
  const arr = () => {
    i++;
    const a = [];
    ws();
    if (src[i] === "]") { i++; return a; }
    for (;;) {
      ws();
      if (src.startsWith("...", i)) { i += 3; const v = value(); a.push({ $spreadArr: v }); }
      else a.push(value());
      ws();
      if (src[i] === ",") { i++; continue; }
      if (src[i] === "]") { i++; return a; }
      throw new Bail(`expected , or ] at ${JSON.stringify(src.slice(i, i + 30))}`);
    }
  };
  const v = value();
  const tail = src.slice(i, i + 400);
  const concat = /^\.concat\(([^)]*)\)/.exec(tail);
  return { value: v, end: i, concat: concat ? concat[1] : null };
}

const out = [];
for (const file of process.argv.slice(3)) {
  const src = readFileSync(file, "utf8");
  let at = 0;
  for (;;) {
    at = src.indexOf('{kind:"Document"', at);
    if (at < 0) break;
    const before = src.slice(Math.max(0, at - 40), at);
    const assigned = /([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before)?.[1] ?? null;
    try {
      const { value, end, concat } = parseLiteral(src, at);
      const defs = (value.definitions ?? []).filter((d) => d && d.kind);
      const ops = defs.filter((d) => d.kind === "OperationDefinition");
      const frags = defs.filter((d) => d.kind === "FragmentDefinition");
      let text = null;
      try { text = print({ kind: "Document", definitions: defs }); } catch (e) { text = `/* print failed: ${e.message} */`; }
      out.push({
        file: basename(file),
        offset: at,
        assigned,
        operations: ops.map((o) => ({ type: o.operation, name: o.name?.value ?? null })),
        fragments: frags.map((f) => f.name.value),
        spreadsUnresolved: JSON.stringify(value).includes('"$ref"') || !!concat,
        concat,
        text,
      });
      at = end;
    } catch (e) {
      if (!(e instanceof Bail)) throw e;
      out.push({ file: basename(file), offset: at, error: e.message });
      at += 10;
    }
  }
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
const ops = out.flatMap((d) => (d.operations ?? []).map((o) => `${o.type} ${o.name}`));
console.log(`${out.length} documents, ${out.filter((d) => d.error).length} unparsed, ${ops.length} operations`);
console.log([...new Set(ops)].sort().join("\n"));
