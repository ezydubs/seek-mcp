import { search } from "./api.js";
import { ORIGIN, careerGql, clean, htmlToText } from "./seek.js";

const roleUrl = (alias: string) => `${ORIGIN}/career-advice/role/${alias}`;
const articleUrl = (alias: string) => `${ORIGIN}/career-advice/article/${alias}`;

export async function careerSearch(p: { term: string; type?: "roles" | "articles" | "all"; size?: number; from?: number }) {
  const size = Math.min(p.size ?? 10, 50);
  if (p.type === "articles") {
    const d = await careerGql("SearchV2Articles", { term: p.term, size, from: p.from ?? 0 });
    return {
      total: d?.searchV2?.total,
      articles: (d?.searchV2?.items ?? []).map((a: any) => clean({ alias: a.alias, title: a.title?.trim(), readTime: a.readTime, url: articleUrl(a.alias) })),
    };
  }
  const d = await careerGql("SearchV2", { term: p.term, size, from: p.from ?? 0 });
  const items = (d?.searchV2?.items ?? []).filter((i: any) => p.type !== "roles" || i.type === "role");
  return {
    total: d?.searchV2?.total,
    results: items.map((i: any) =>
      clean({
        type: i.type,
        alias: i.alias,
        title: i.title?.trim(),
        typicalSalary: i.typicalSalaryMin ? `$${i.typicalSalaryMin.toLocaleString("en-NZ")}–$${i.typicalSalaryMax?.toLocaleString("en-NZ")}` : undefined,
        jobSatisfaction: i.jobSatisfaction,
        growthPercent: i.growthValue,
        classification: i.classifications?.map((c: any) => c.class).join(", "),
        readTime: i.readTime,
        url: i.type === "role" ? roleUrl(i.alias) : articleUrl(i.alias),
      }),
    ),
  };
}

export async function careerRoleSuggest(term: string, size = 10) {
  const d = await careerGql("AutoSuggestV2", { term, size, filter: { type: "ROLE" } });
  return (d?.autoSuggestV2?.items ?? []).map((i: any) => ({ alias: i.alias, title: i.title }));
}

async function roleAlias(ref: string): Promise<string> {
  const s = ref.trim().replace(/^https?:\/\/[^/]+\/career-advice\/role\//, "").split(/[/?#]/)[0];
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) return s;
  const hit = (await careerRoleSuggest(s, 1))[0];
  if (!hit) throw new Error(`Seek's career guide has no role matching "${ref}"`);
  return hit.alias;
}

export async function careerRole(ref: string) {
  const alias = await roleAlias(ref);
  const opt = { partialOk: true };
  const [role, duties, like, how, skills, stats, hours, growth, similar] = await Promise.all([
    careerGql("GetRole", { alias, specReqInput: { size: 15 } }, opt),
    careerGql("GetRoleTasksAndDuties", { alias }, opt).catch(() => null),
    careerGql("GetRoleWhatsItLike", { alias }, opt).catch(() => null),
    careerGql("GetHowToBecome", { alias }, opt).catch(() => null),
    careerGql("GetRoleSpecReqs", { alias, specReqInput: { size: 25 } }, opt).catch(() => null),
    careerGql("GetRoleReviewStats", { alias }, opt).catch(() => null),
    careerGql("GetWorkHours", { alias }, opt).catch(() => null),
    careerGql("GetRoleGrowth", { alias }, opt).catch(() => null),
    careerGql("GetSimilarRoles", { alias }, opt).catch(() => null),
  ]);
  const r = role?.roleByAlias;
  if (!r) throw new Error(`Seek's career guide has no role "${alias}"`);
  const howTo = how?.roleByAlias?.howToBecome;
  return clean({
    alias,
    roleId: r.role_id,
    title: r.title,
    typicalSalary: r.typicalSalary ? { min: r.typicalSalary.salary_min, max: r.typicalSalary.salary_max } : undefined,
    classifications: r.classifications?.map((c: any) => c.classification),
    whatItsLike: htmlToText([like?.roleByAlias?.whatsItLike?.introduction ?? r.whatsItLike?.introduction, like?.roleByAlias?.whatsItLike?.extraContent].filter(Boolean).join("\n\n")),
    tasksAndDuties: duties?.roleByAlias?.whatsItLike?.tasksAndDuties?.map((t: any) => htmlToText(t.text)),
    howToBecome: howTo
      ? { overview: htmlToText(howTo.content), steps: howTo.steps?.map((s: any) => clean({ ...s, text: s.text ? htmlToText(s.text) : undefined })) }
      : undefined,
    skills: skills?.roleByAlias?.specReqs?.map((s: any) => clean({ skill: s.label, type: s.type })),
    reviews: stats?.roleByAlias?.roleReviewStatistics,
    workingHours: hours?.roleByAlias?.roleReviewStatistics,
    growth: growth?.roleByAlias?.growth,
    similarRoles: similar?.roleByAlias?.similarRoles?.map((s: any) =>
      clean({ alias: s.alias, title: s.title, satisfaction: s.roleReviewStatistics?.jobSatisfaction, growth: s.growth?.value, salary: s.salarySuggestion?.suggestion }),
    ),
    url: roleUrl(alias),
  });
}

export async function careerRoleReviews(ref: string, p: { sentiment?: "positive" | "negative"; from?: number; size?: number } = {}) {
  const alias = await roleAlias(ref);
  const d = await careerGql("GetRoleReviews", { roleId: alias, sentiment: p.sentiment, from: p.from ?? 0, size: Math.min(p.size ?? 10, 30) });
  return (d?.roleReviews ?? []).map((r: any) => clean(r));
}

export async function careerSalary(ref: string, p: { region?: string; type?: "annual" | "hourly" } = {}) {
  const alias = await roleAlias(ref);
  const role = (await careerGql("GetRole", { alias, specReqInput: { size: 1 } }, { partialOk: true }))?.roleByAlias;
  if (!role) throw new Error(`Seek's career guide has no role "${alias}"`);
  let locationId: number | undefined = 3001;
  if (p.region) {
    const s: any = await search({ where: p.region, pageSize: 1 });
    locationId = Number(s?.where?.whereId) || undefined;
    if (!locationId) throw new Error(`Seek did not recognise the region "${p.region}"`);
  }
  const [salary, byIndustry] = await Promise.all([
    careerGql("GetSalarySuggestionByRoleAndLocation", {
      role_id: role.role_id ?? alias, roleTitle: role.title, locationId, ...(p.type === "hourly" ? { salaryType: "HOURLY" } : {}),
    }),
    careerGql("GetRoleClassSalariesById", { role_id: role.role_id ?? alias }, { partialOk: true }).catch(() => null),
  ]);
  const s = salary?.salarySuggestionByRoleIdAndLocationId;
  return clean({
    role: role.title,
    where: s?.locationName,
    type: p.type ?? "annual",
    typicalRange: s?.suggestion,
    median: s?.salary_median,
    range: s ? { min: s.salary_min, max: s.salary_max } : undefined,
    basedOnMonths: s?.in_months,
    byIndustry: byIndustry?.role?.classSalaries?.map((c: any) => ({ industry: c.class_title, averageSalary: Math.round(c.avg_salary) })),
    url: `${roleUrl(alias)}/salary`,
  });
}

export async function careerRolesByClassification(classification?: string) {
  const list = (await careerGql("Classifications"))?.classificationList ?? [];
  if (!classification) return list.map((c: any) => ({ classification: c.classification, id: c.classificationCode, segment: c.classificationUrlSegment }));
  const hit = list.find((c: any) =>
    [c.classification, c.classificationUrlSegment, String(c.classificationCode)].some((v) => v?.toLowerCase() === classification.toLowerCase()),
  );
  if (!hit) throw new Error(`No classification "${classification}" (try one of: ${list.map((c: any) => c.classification).join(", ")})`);
  const d = await careerGql("GetRolesByClassificationUrl", { segment: hit.classificationUrlSegment });
  return {
    classification: hit.classification,
    roles: (d?.rolesByClassification ?? []).map((r: any) =>
      clean({ alias: r.alias, title: r.title, satisfaction: r.roleReviewStatistics?.jobSatisfaction, growth: r.growth?.value, salary: r.salarySuggestion?.suggestion }),
    ),
  };
}

export async function careerArticle(alias?: string, p: { size?: number; from?: number } = {}) {
  if (!alias) {
    const d = await careerGql("GetLatestArticles", { size: Math.min(p.size ?? 10, 30), from: p.from ?? 0 });
    return (d?.articlesV2 ?? []).map((a: any) => clean({ alias: a.alias, title: a.title, minutes: a.minutes, category: a.mainCategory?.name, abstract: a.abstract, url: articleUrl(a.alias) }));
  }
  const slug = alias.trim().replace(/^https?:\/\/[^/]+\/career-advice\/article\//, "").split(/[/?#]/)[0];
  const a = (await careerGql("GetArticleV2", { alias: slug }))?.articleV2ByAlias;
  if (!a) throw new Error(`No career-advice article "${slug}"`);
  return clean({
    alias: a.alias,
    title: a.title,
    category: a.mainCategory?.name,
    tags: a.tags,
    words: a.wordCount,
    updated: a.lastModifiedInSeconds ? new Date(a.lastModifiedInSeconds * 1000).toISOString() : undefined,
    text: htmlToText(a.content),
    url: articleUrl(a.alias),
  });
}
