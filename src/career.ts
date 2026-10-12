import { search } from "./api.js";
import { NotLoggedInError, accessToken, isSignedIn } from "./auth.js";
import { suggest } from "./discover.js";
import { D, type DocumentName } from "./documents.js";
import { CAREER_API, ORIGIN, SITE_HEADERS, UA, careerGql, clean, htmlToText, postGraphql, unwrap, type GqlBody } from "./seek.js";

const roleUrl = (alias: string) => `${ORIGIN}/career-advice/role/${alias}`;
const articleUrl = (alias: string) => `${ORIGIN}/career-advice/article/${alias}`;
const NEW_ZEALAND = 3001;
const SKILL_TYPES = ["ReferenceableExperience", "ObservableAttributes", "VerifiableAttainments"];
const TOP_CATEGORIES = ["explore-careers", "job-hunting", "working-life"];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const EGADS = CAREER_API.replace(/\/graphql$/, "/egads");
const EGADS_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: SITE_HEADERS.accept,
  "x-seek-site": "skl-career-guide-site",
  "apollographql-client-name": "Career advice site",
  origin: ORIGIN,
  referer: `${ORIGIN}/`,
  "user-agent": UA,
};

const refusedSignIn = (body: GqlBody) =>
  (body.errors ?? []).some((e) => ["UNAUTHORIZED", "UNAUTHENTICATED", "FORBIDDEN"].includes(e.extensions?.code ?? "") || /authToken/.test(e.message));

async function egads(name: DocumentName, variables: Record<string, unknown>, signedOut: string | false) {
  let token = signedOut === false ? await accessToken() : isSignedIn() ? await accessToken().catch(() => undefined) : undefined;
  const send = async () =>
    (await postGraphql(EGADS, D[name], variables, { ...EGADS_HEADERS, ...(token ? { authorization: `Bearer ${token}` } : {}) })).body;
  let body = await send();
  if (token && refusedSignIn(body)) {
    token = await accessToken(true);
    body = await send();
  }
  if (refusedSignIn(body)) throw new NotLoggedInError(token || signedOut === false ? "Seek rejected the sign-in. Run seek_auth again." : signedOut);
  return unwrap(body, name);
}

async function region(where?: string): Promise<{ id: number; name: string }> {
  if (!where) return { id: NEW_ZEALAND, name: "New Zealand" };
  const s: any = await search({ where, pageSize: 1 });
  const id = Number(s?.where?.whereId);
  if (!id) throw new Error(`Seek did not recognise the region "${where}"`);
  return { id, name: s.where.understoodAs ?? where };
}

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

async function roleBasics(alias: string) {
  const r = (await careerGql("GetRole", { alias, specReqInput: { size: 1 } }, { partialOk: true }))?.roleByAlias;
  if (!r) throw new Error(`Seek's career guide has no role "${alias}"`);
  return r;
}

export async function careerRole(ref: string, p: { region?: string } = {}) {
  const alias = await roleAlias(ref);
  const opt = { partialOk: true };
  const rolePromise = careerGql("GetRole", { alias, specReqInput: { size: 15 } }, opt);
  const regionPromise = region(p.region);
  const snapshot = Promise.all([rolePromise, regionPromise])
    .then(([d, loc]) =>
      careerGql("GetSnapshot", { alias, keywords: d?.roleByAlias?.title ?? alias.replace(/-/g, " "), locationId: String(loc.id) }, opt),
    )
    .catch(() => null);
  const [role, duties, like, how, skills, stats, hours, growth, similar, loc, snap] = await Promise.all([
    rolePromise,
    careerGql("GetRoleTasksAndDuties", { alias }, opt).catch(() => null),
    careerGql("GetRoleWhatsItLike", { alias }, opt).catch(() => null),
    careerGql("GetHowToBecome", { alias }, opt).catch(() => null),
    careerGql("GetRoleSpecReqs", { alias, specReqInput: { size: 25 } }, opt).catch(() => null),
    careerGql("GetRoleReviewStats", { alias }, opt).catch(() => null),
    careerGql("GetWorkHours", { alias }, opt).catch(() => null),
    careerGql("GetRoleGrowth", { alias }, opt).catch(() => null),
    careerGql("GetSimilarRoles", { alias }, opt).catch(() => null),
    regionPromise,
    snapshot,
  ]);
  const r = role?.roleByAlias;
  if (!r) throw new Error(`Seek's career guide has no role "${alias}"`);
  const howTo = how?.roleByAlias?.howToBecome;
  const jobs = snap?.jobCountV2;
  return clean({
    alias,
    roleId: r.role_id,
    title: r.title,
    typicalSalary: r.typicalSalary ? { min: r.typicalSalary.salary_min, max: r.typicalSalary.salary_max } : undefined,
    classifications: r.classifications?.map((c: any) => c.classification),
    liveJobs: jobs ? { total: jobs.total, where: loc.name, url: jobs.url } : undefined,
    whatItsLike: htmlToText([like?.roleByAlias?.whatsItLike?.introduction ?? r.whatsItLike?.introduction, like?.roleByAlias?.whatsItLike?.extraContent].filter(Boolean).join("\n\n")),
    tasksAndDuties: duties?.roleByAlias?.whatsItLike?.tasksAndDuties?.map((t: any) => htmlToText(t.text)),
    howToBecome: howTo
      ? { overview: htmlToText(howTo.content), steps: howTo.steps?.map((s: any) => clean({ ...s, text: s.text ? htmlToText(s.text) : undefined })) }
      : undefined,
    skills: skills?.roleByAlias?.specReqs?.map((s: any) => clean({ skill: s.label, type: s.type, id: s.id })),
    reviews: stats?.roleByAlias?.roleReviewStatistics,
    workingHours: hours?.roleByAlias?.roleReviewStatistics,
    growth: growth?.roleByAlias?.growth,
    similarRoles: similar?.roleByAlias?.similarRoles?.map((s: any) =>
      clean({ alias: s.alias, title: s.title, satisfaction: s.roleReviewStatistics?.jobSatisfaction, growth: s.growth?.value, salary: s.salarySuggestion?.suggestion }),
    ),
    url: roleUrl(alias),
  });
}

export async function careerPathways(
  ref: string,
  p: { size?: number; differentField?: boolean; minSalaryLiftPercent?: number; maxSalaryLiftPercent?: number; region?: string } = {},
) {
  const alias = await roleAlias(ref);
  const pathwayRoleInput = clean({
    cgRolesSize: Math.min(p.size ?? 5, 20),
    isDivergent: p.differentField,
    minSalaryLiftPercent: p.minSalaryLiftPercent,
    maxSalaryLiftPercent: p.maxSalaryLiftPercent,
  });
  const [d, loc] = await Promise.all([careerGql("GetPathwayRolesBase", { alias, pathwayRoleInput }), region(p.region)]);
  if (!d?.roleByAlias) throw new Error(`Seek's career guide has no role "${alias}"`);
  const roles = (d.roleByAlias.pathwayRoles?.cgRoles ?? []).map((c: any) => c?.role).filter((r: any) => r?.isReleased);
  const counts = await Promise.all(
    roles.map((r: any) =>
      careerGql("GetJobCount", { keywords: r.title, locationId: String(loc.id) }).then((x) => x?.jobCountV2?.total, () => undefined),
    ),
  );
  return clean({
    role: alias,
    toOtherFields: p.differentField || undefined,
    liveJobsIn: loc.name,
    pathways: roles.map((r: any, i: number) =>
      clean({ alias: r.alias, title: r.title, salaryFrom: r.typicalSalary?.salary_min, liveJobs: counts[i], url: roleUrl(r.alias) }),
    ),
  });
}

export async function careerRoleJobs(ref: string, p: { region?: string; size?: number } = {}) {
  const alias = await roleAlias(ref);
  const [role, loc] = await Promise.all([roleBasics(alias), region(p.region)]);
  const s = (await careerGql("GetLatestJobs", { size: Math.min(p.size ?? 10, 50), keywords: role.title, locationId: String(loc.id) }))?.jobSearch;
  return clean({
    role: role.title,
    where: loc.name,
    total: s?.total,
    searchUrl: s?.url,
    jobs: (s?.jobs ?? []).map((j: any) =>
      clean({
        id: j.id,
        title: j.title,
        company: j.employer?.name,
        location: j.locations?.map((l: any) => l.name).filter(Boolean).join("; "),
        salary: j.salary?.displayValue,
        workType: j.workType,
        category: j.subClassification ?? j.classification,
        listed: j.createdAt,
        teaser: j.abstract,
        url: `${ORIGIN}/job/${j.id}`,
      }),
    ),
  });
}

export async function careerRoleReason(ref: string) {
  const alias = await roleAlias(ref);
  const role = await roleBasics(alias);
  const d = await egads("RoleBlurb", { roleId: role.role_id ?? alias }, false);
  const recommendations = (d?.getRoleRecommendationBlurb ?? []).map((r: any) => clean({ recommendationId: r.id, reason: r.reason, hidden: r.userHidden }));
  return clean({
    role: alias,
    title: role.title,
    recommendations,
    note: recommendations.length ? undefined : "Career Compass has not recommended this role to this account.",
  });
}

export interface QuizAnswer {
  choices?: string[];
  text?: string;
  role?: string;
}

function quizAnswer(a: QuizAnswer) {
  const out: Record<string, unknown> = {};
  if (a.choices) out.multichoice = { selectedChoices: a.choices };
  if (a.text != null) out.freeText = { answer: a.text };
  if (a.role != null) out.profileFields = { values: [{ field: "RoleTitle", value: a.role }] };
  return out;
}

export async function careerQuiz(p: { step?: number; answers?: QuizAnswer[] } = {}) {
  const answers = p.answers ?? [];
  const step = p.step ?? answers.length;
  const needsSignIn =
    "Career Compass's last step (its recommendations) needs a sign-in: run seek_auth, then ask for this step again with the same answers.";
  const [count, res] = await Promise.all([
    egads("QuestionCount", {}, needsSignIn).then((d) => Number(d?.questionCount)),
    egads("Question", { questionNumber: step, previousAnswers: answers.map(quizAnswer) }, needsSignIn).then(
      (d) => ({ d, e: null }),
      (e) => ({ d: null, e }),
    ),
  ]);
  if (step >= count) throw new Error(`Career Compass has ${count} steps, numbered 0 to ${count - 1}`);
  if (res.e) throw res.e;
  const q = res.d?.question;
  const at = { step, totalSteps: count };
  switch (q?.__typename) {
    case "MultichoiceQuestion":
      return clean({
        ...at,
        kind: "multichoice",
        question: q.question,
        choices: (q.choices ?? []).map((c: any) => c.title),
        subtitles: Object.fromEntries((q.choices ?? []).filter((c: any) => c.subtitle).map((c: any) => [c.title, c.subtitle])),
        answerWith: "{ choices: [one or more of the choices, exactly as written] }",
      });
    case "FreeTextQuestion":
      return clean({ ...at, kind: "freeText", question: q.question, example: q.quote?.comment, answerWith: '{ text: "…" }' });
    case "ProfileInfoRequest":
      return clean({
        ...at,
        kind: "profile",
        question: q.question,
        fields: q.fields,
        answerWith: '{ role: "current role title" }',
        note: isSignedIn() ? undefined : "The next step (the recommendations) needs a sign-in (seek_auth).",
      });
    case "Prompt":
      return clean({
        ...at,
        kind: "prompt",
        text: q.text,
        next: `No answer: ask for step ${step + 1} with the same answers, and pass step explicitly from here on`,
      });
    case "JobsRec":
      return clean({
        ...at,
        kind: "recommendations",
        text: q.text,
        recommendations: (q.recommendations ?? []).map((r: any) =>
          clean({ recommendationId: r.id, role: r.role_id, title: r.title, reason: r.reason, url: r.role_id ? roleUrl(r.role_id) : undefined }),
        ),
      });
    default:
      throw new Error(`Career Compass returned a step this server does not know: ${JSON.stringify(q).slice(0, 200)}`);
  }
}

export async function careerHideRecommendation(recommendationId: string, hide: boolean) {
  const d = await egads("HideRecommendation", { hide, recommendationId }, false);
  if (d?.hideRecommendation !== true) {
    throw new Error(
      `Seek reported no change to recommendation ${recommendationId} (it may already be ${hide ? "hidden" : "shown"}, or not belong to this account)`,
    );
  }
  return { recommendationId, hidden: hide };
}

export async function careerRoleReviews(ref: string, p: { sentiment?: "positive" | "negative"; from?: number; size?: number } = {}) {
  const alias = await roleAlias(ref);
  const d = await careerGql("GetRoleReviews", { roleId: alias, sentiment: p.sentiment, from: p.from ?? 0, size: Math.min(p.size ?? 10, 30) });
  return (d?.roleReviews ?? []).map((r: any) => clean(r));
}

export async function careerSalary(ref: string, p: { region?: string; type?: "annual" | "hourly" } = {}) {
  const alias = await roleAlias(ref);
  const [role, loc] = await Promise.all([roleBasics(alias), region(p.region)]);
  const [salary, byIndustry] = await Promise.all([
    careerGql("GetSalarySuggestionByRoleAndLocation", {
      role_id: role.role_id ?? alias, roleTitle: role.title, locationId: loc.id, ...(p.type === "hourly" ? { salaryType: "HOURLY" } : {}),
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

async function findClassification(ref: string) {
  const list = (await careerGql("Classifications"))?.classificationList ?? [];
  const hit = list.find((c: any) =>
    [c.classification, c.classificationUrlSegment, String(c.classificationCode)].some((v) => v?.toLowerCase() === ref.trim().toLowerCase()),
  );
  if (!hit) throw new Error(`No classification "${ref}" (try one of: ${list.map((c: any) => c.classification).join(", ")})`);
  return hit;
}

export async function careerRolesByClassification(classification?: string) {
  if (!classification) {
    const list = (await careerGql("Classifications"))?.classificationList ?? [];
    return list.map((c: any) => ({ classification: c.classification, id: c.classificationCode, segment: c.classificationUrlSegment }));
  }
  const hit = await findClassification(classification);
  const d = await careerGql("GetRolesByClassificationUrl", { segment: hit.classificationUrlSegment });
  return {
    classification: hit.classification,
    roles: (d?.rolesByClassification ?? []).map((r: any) =>
      clean({ alias: r.alias, title: r.title, satisfaction: r.roleReviewStatistics?.jobSatisfaction, growth: r.growth?.value, salary: r.salarySuggestion?.suggestion }),
    ),
  };
}

async function skillId(ref: string): Promise<{ id: string; skill?: string }> {
  const m = UUID.exec(ref);
  if (m) return { id: m[0].toLowerCase() };
  const hits = (await suggest("skills", ref)) as Array<{ text: string; ontologyId: string }>;
  const hit = hits.find((h) => h.text.toLowerCase() === ref.trim().toLowerCase()) ?? hits[0];
  const id = hit && UUID.exec(hit.ontologyId)?.[0];
  if (!id) throw new Error(`Seek knows no skill matching "${ref}"`);
  return { id: id.toLowerCase(), skill: hit.text };
}

export async function careerRolesBySkills(skills: string[], p: { size?: number; topSkills?: number } = {}) {
  const resolved = await Promise.all(skills.map(skillId));
  const ids = [...new Set(resolved.map((r) => r.id))];
  const d = await careerGql("GetRolesBySkills", {
    rolesBySpecReqsInput: { specReqIds: ids, size: Math.min(p.size ?? 20, 50), ...(p.topSkills ? { maxSpecReqOrder: p.topSkills } : {}) },
    specReqInput: { size: 20, types: SKILL_TYPES },
  });
  const labels = new Map<string, string>();
  const roles = (d?.rolesBySpecReqIds ?? [])
    .filter((r: any) => r.isReleased)
    .map((r: any) => {
      const matched = (r.specReqs ?? []).filter((s: any) => ids.includes(s.id));
      for (const s of matched) labels.set(s.id, s.label);
      return { r, matched: matched.map((s: any) => s.label) as string[] };
    })
    .sort((a: any, b: any) => b.matched.length - a.matched.length);
  return {
    skills: resolved.map((s) => clean({ skill: labels.get(s.id) ?? s.skill, id: s.id })),
    roles: roles.map(({ r, matched }: any) =>
      clean({
        alias: r.alias,
        title: r.title,
        matchedSkills: matched,
        satisfaction: r.roleReviewStatistics?.jobSatisfaction,
        growth: r.growth?.value,
        salary: r.salarySuggestion?.suggestion,
        url: roleUrl(r.alias),
      }),
    ),
  };
}

async function themeLabel(ref: string): Promise<string> {
  const themes: Array<{ button: string }> = (await careerGql("RoleByThemeCount", { filter: { types: ["ROLE"] } }))?.searchV2?.themes ?? [];
  const r = ref.trim().toLowerCase();
  const hit = themes.find((t) => t.button.toLowerCase() === r) ?? themes.find((t) => t.button.toLowerCase().includes(r));
  if (!hit) throw new Error(`No career theme "${ref}" (one of: ${themes.map((t) => t.button).join(", ")})`);
  return hit.button;
}

export async function careerRoleCounts(
  p: { classification?: string; theme?: string; minSalary?: number; maxSalary?: number; minSatisfaction?: number; minGrowth?: number } = {},
) {
  const [classification, theme] = await Promise.all([
    p.classification ? findClassification(p.classification).then((c) => c.classification as string) : undefined,
    p.theme ? themeLabel(p.theme) : undefined,
  ]);
  const filter = clean({
    types: ["ROLE"],
    classifications: classification ? [classification] : undefined,
    themes: theme ? [theme] : undefined,
    salaryMin: p.minSalary,
    salaryMax: p.maxSalary,
    satisfaction: p.minSatisfaction,
    growth: p.minGrowth,
  });
  const [industries, themes] = await Promise.all([careerGql("RoleByIndustryCount", { filter }), careerGql("RoleByThemeCount", { filter })]);
  return clean({
    filter: { ...filter, types: undefined },
    roles: industries?.searchV2?.total,
    byIndustry: (industries?.searchV2?.classifications ?? []).map((c: any) => ({ industry: c.class, roles: c.count })),
    byTheme: (themes?.searchV2?.themes ?? []).map((t: any) => ({ theme: t.button, roles: t.count })),
  });
}

const articleCard = (a: any) =>
  clean({ alias: a.alias, title: a.title?.trim(), minutes: a.minutes, category: a.mainCategory?.name, abstract: a.abstract, url: articleUrl(a.alias) });

async function categoryArticles(ref: string, p: { size?: number; from?: number }) {
  const alias = ref.trim().split(/[?#]/)[0].replace(/\/+$/, "").split("/").pop()!.toLowerCase().replace(/\s+/g, "-");
  const size = Math.min(p.size ?? 10, 30);
  if (TOP_CATEGORIES.includes(alias)) {
    const d = await careerGql("GetUnifiedTopFeaturedArticle", { categoryAlias: alias, size });
    return { category: alias, featured: true, articles: (d?.unifiedArticlesByTopCategoryAlias ?? []).map(articleCard) };
  }
  const c = (await careerGql("GetCategoryByAlias", { alias }))?.categoryByAliasV2;
  if (!c) {
    throw new Error(
      `No career-advice category "${alias}" (top categories: ${TOP_CATEGORIES.join(", ")}; or one inside them such as resumes, ` +
        "cover-letters, job-interviews, changing-careers, salary-advice)",
    );
  }
  const d = await careerGql("GetArticlesByCategoryId", { id: c.id, size, from: p.from ?? 0 });
  return clean({
    category: c.name,
    alias: c.alias,
    within: c.topCategory?.alias,
    articles: (d?.articlesV2ByCategory ?? []).map((a: any) => ({ ...articleCard(a), category: undefined })),
  });
}

export async function careerArticle(
  alias?: string,
  p: { list?: "latest" | "featured" | "popular"; category?: string; size?: number; from?: number } = {},
) {
  if (!alias) {
    if (p.category) return categoryArticles(p.category, p);
    if (p.list === "featured") {
      const all = (await careerGql("FeaturedContent"))?.featuredContent ?? [];
      const from = p.from ?? 0;
      return all.slice(from, p.size ? from + p.size : undefined).map((f: any) =>
        clean({
          alias: f.alias,
          title: f.title?.trim(),
          type: f.type === "article" ? undefined : f.type,
          minutes: f.ctaText,
          abstract: f.description?.trim(),
          url: f.type === "article" ? articleUrl(f.alias) : f.type === "role" ? roleUrl(f.alias) : undefined,
        }),
      );
    }
    if (p.list === "popular") return ((await careerGql("GetArticlesForRoles"))?.articlesForRoles ?? []).map(articleCard);
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
