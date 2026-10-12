import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const FULL = process.argv.includes("--full");
const p = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, SEEK_TOKEN_DIR: "/nonexistent-seek-check" } });
let buf = "";
const waiters = new Map();
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  }
});
let n = 0;
const call = (method, params) =>
  new Promise((res, rej) => {
    const id = ++n;
    waiters.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

const results = [];
const tool = async (name, args, summarise) => {
  const t = Date.now();
  const r = await call("tools/call", { name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  const ms = Date.now() - t;
  let line;
  try { line = r.isError ? text.slice(0, 300) : summarise(data); } catch (e) { line = `summary failed: ${e.message}`; }
  results.push({ name, ok: !r.isError, ms });
  console.log(`${r.isError ? "✗" : "✓"} ${name} ${JSON.stringify(args)} — ${ms}ms\n    ${line}`);
  if (FULL && !r.isError) console.log(JSON.stringify(data, null, 1).slice(0, 2000));
  return r.isError ? null : data;
};

await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check-public", version: "0" } });
p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const s = await tool("seek_search", { keywords: "accountant", where: "All Auckland", workArrangement: ["hybrid"], pageSize: 5, sort: "newest" },
  (d) => `${d.total} jobs; where=${JSON.stringify(d.where)}; facets=${Object.keys(d.facets ?? {}).join(",")}; first: ${d.jobs[0]?.title} (${d.jobs[0]?.arrangement})`);
await tool("seek_search", { classification: [1200], subclassification: [6140], where: "All Auckland", pageSize: 3 },
  (d) => `${d.total} jobs; ${d.jobs.map((j) => `${j.category}`).join(" | ")}`);
const jobId = s?.jobs?.find((j) => !j.promoted)?.id ?? s?.jobs?.[0]?.id;
if (jobId) {
  await tool("seek_job", { id: jobId }, (d) => `${d.title} @ ${d.company} — ${d.location}; arrangement=${d.workArrangement}; questions=${d.employerQuestions?.length ?? 0}; company rating=${d.companyProfile?.rating ?? "-"}; ${d.description?.length} chars`);
  await tool("seek_similar_jobs", { id: jobId }, (d) => `${d.length} similar: ${d.slice(0, 3).map((j) => j.title).join(" | ")}`);
}
for (const [kind, query] of [["keywords", "accoun"], ["search_locations", "ponson"], ["profile_locations", "ponsonby"], ["role_titles", "softw"], ["companies", "kiwib"], ["schools", "univ of auck"], ["qualifications", "bachelor of com"], ["skills", "pyth"], ["licences", "forklift"], ["languages", "maor"], ["rights_to_work", "new zealand"]]) {
  await tool("seek_suggest", { kind, query, count: 3 }, (d) => JSON.stringify(d).slice(0, 220));
}
await tool("seek_classifications", {}, (d) => `${d.classifications.length} classifications; availability=${d.profileOptions.availability.map((a) => a.description).join("/")}; visibility=${d.profileOptions.visibility.map((v) => v.id).join("/")}`);

const cs = await tool("seek_company_search", { name: "ryman healthcare", limit: 3 }, (d) => d.map((c) => `${c.name} ${c.id} (${c.reviews ?? 0} reviews)`).join(" | "));
const companyId = cs?.[0]?.id ?? "171714227249285";
await tool("seek_company", { company: companyId }, (d) => `${d.name}: ${d.industry}, ${d.size}; overall=${d.ratings?.overall?.rating}; summary=${d.reviewSummary ? "yes" : "no"}; org=${d.organisationId}`);
await tool("seek_company_reviews", { company: companyId, perPage: 2, sort: "recent", withLocations: true }, (d) => `${d.totalReviews} reviews, rating ${d.overallRating}; first: "${d.reviews?.[0]?.title}"; locations: ${d.locations?.slice(0, 3).join(", ")}`);
await tool("seek_company_reviews", { company: companyId, perPage: 2, location: "All Auckland" }, (d) => `Auckland: ${d.paging?.total ?? d.reviews?.length} reviews; first at ${d.reviews?.[0]?.location}`);
await tool("seek_company_salaries", { company: "kiwibank" }, (d) => `${d.roles?.length ?? 0} roles; updated ${d.updated}`);
await tool("seek_company_jobs", { company: "kiwibank", pageSize: 3 }, (d) => `${d.total} jobs at ${d.company}: ${d.jobs.map((j) => j.title).join(" | ")}`);

await tool("seek_career_search", { term: "nurse", size: 3 }, (d) => `${d.total} results: ${d.results.map((r) => `${r.title} (${r.type})`).join(" | ")}`);
await tool("seek_career_search", { term: "cover letter", type: "articles", size: 3 }, (d) => `${d.total} articles: ${d.articles.map((a) => a.title).join(" | ")}`);
await tool("seek_career_search", { term: "data an", suggest: true, size: 3 }, (d) => d.map((r) => r.alias).join(", "));
await tool("seek_career_role", { role: "accountant" }, (d) => `${d.title}: salary ${JSON.stringify(d.typicalSalary)}; duties=${d.tasksAndDuties?.length}; skills=${d.skills?.length}; similar=${d.similarRoles?.length}; how-to: ${d.howToBecome?.overview?.slice(0, 80)}`);
await tool("seek_career_salary", { role: "accountant", region: "All Auckland" }, (d) => `${d.role} in ${d.where}: ${JSON.stringify(d.typicalRange)} median ${d.median}; industries=${d.byIndustry?.length}`);
await tool("seek_career_salary", { role: "registered nurse", type: "hourly" }, (d) => `${d.role} (${d.type}) ${d.where}: ${JSON.stringify(d.typicalRange)}`);
await tool("seek_career_reviews", { role: "accountant", size: 2 }, (d) => `${d.length} reviews: ${d.map((r) => r.title).join(" | ")}`);
await tool("seek_career_explore", {}, (d) => `${d.length} classifications`);
await tool("seek_career_explore", { classification: "Accounting" }, (d) => `${d.roles?.length} roles in ${d.classification}`);
await tool("seek_career_article", {}, (d) => `${d.length} latest: ${d.slice(0, 2).map((a) => a.title).join(" | ")}`);
await tool("seek_career_article", { alias: "how-to-choose-a-career" }, (d) => `${d.title}: ${d.text?.length} chars`);

const ppl = await tool("seek_people_search", { query: "accountant", locations: ["Auckland"], pageSize: 3 }, (d) => `exact=${d.exactMatches?.length ?? 0} partial=${d.partialMatches?.length ?? 0}`);
const slug = ppl?.exactMatches?.[0]?.slug ?? ppl?.partialMatches?.[0]?.slug;
if (slug) await tool("seek_person", { slug }, (d) => `${d.restricted ? "restricted" : "full"} profile; roles=${d.roles?.length ?? 0}; skills=${d.skills?.length ?? 0}`);

await tool("seek_recruiter_search", { filters: true }, (d) => `regions NZ: ${(d.regions["New Zealand"] ?? []).slice(0, 4).join(", ")}…; ${d.specialisations.length} specialisations`);
const rs = await tool("seek_recruiter_search", { placementTitle: "accountant", region: "Auckland", pageSize: 3 }, (d) => `${d.total} recruiters: ${d.results.map((r) => `${r.name} (${r.agency})`).join(" | ")}`);
await tool("seek_recruiter_search", { type: "agency", pageSize: 3 }, (d) => `${d.total} agencies: ${d.results.map((r) => r.name).join(" | ")}`);
const rslug = rs?.results?.[0]?.slug;
if (rslug) {
  await tool("seek_recruiter", { slug: rslug }, (d) => `${d.name} @ ${d.agency?.name}: rating ${d.rating} (${d.reviews}); placements=${d.recentPlacements?.length ?? 0} jobs=${d.openJobs?.length ?? 0}`);
  await tool("seek_recruiter", { slug: rslug, section: "reviews", pageSize: 2 }, (d) => `${d.total} reviews; first: ${d.items?.[0]?.title}`);
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} public calls succeeded${bad.length ? `; failed: ${bad.map((b) => b.name).join(", ")}` : ""}`);
p.kill();
process.exit(bad.length ? 1 : 0);
