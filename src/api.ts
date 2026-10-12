import { ORIGIN, gql, seekGet, sgql } from "./auth.js";
import { ZONE, clean } from "./seek.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

export interface SearchParams {
  keywords?: string;
  where?: string;
  page?: number;
  pageSize?: number;
  sort?: "relevance" | "newest";
  workType?: Array<"full_time" | "part_time" | "contract" | "casual">;
  listedWithinDays?: 1 | 3 | 7 | 14 | 31;
  salaryMin?: number;
  salaryMax?: number;
  salaryType?: "annual" | "hourly";
  classification?: number[];
  subclassification?: number[];
  workArrangement?: Array<"on_site" | "hybrid" | "remote">;
  advertiserId?: string;
  companyId?: string;
}

const WORK_TYPE_IDS = { full_time: 242, part_time: 243, contract: 244, casual: 245 } as const;
const WORK_ARRANGEMENT_IDS = { on_site: 1, hybrid: 2, remote: 3 } as const;

export function searchFilters(p: SearchParams): Record<string, string> {
  const q: Record<string, string> = {};
  if (p.keywords) q.keywords = p.keywords;
  if (p.where) q.where = p.where;
  if (p.workType?.length) q.worktype = p.workType.map((w) => WORK_TYPE_IDS[w]).join(",");
  if (p.listedWithinDays) q.daterange = String(p.listedWithinDays);
  if (p.salaryMin != null || p.salaryMax != null) {
    q.salaryrange = `${p.salaryMin ?? 0}-${p.salaryMax ?? ""}`;
    q.salarytype = p.salaryType ?? "annual";
  }
  if (p.classification?.length) q.classification = p.classification.join(",");
  if (p.subclassification?.length) q.subclassification = p.subclassification.join(",");
  if (p.workArrangement?.length) q.workarrangement = p.workArrangement.map((w) => WORK_ARRANGEMENT_IDS[w]).join(",");
  if (p.advertiserId) q.advertiserid = p.advertiserId;
  if (p.companyId) q.companyid = p.companyId;
  return q;
}

export async function search(p: SearchParams) {
  const q: Record<string, string> = {
    siteKey: "NZ-Main",
    locale: "en-NZ",
    page: String(p.page ?? 1),
    pageSize: String(Math.min(p.pageSize ?? 20, 100)),
    sortmode: p.sort === "newest" ? "ListedDate" : "KeywordRelevance",
    ...searchFilters(p),
    facets: "workType,workArrangement",
  };
  const url = new URL("/api/jobsearch/v5/search", ORIGIN);
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": UA } });
  if (!r.ok) throw new Error(`Seek search returned HTTP ${r.status}`);
  const data = (await r.json()) as any;
  type Raw = {
    id: string; title: string; companyName?: string; advertiser?: { description?: string };
    locations?: { label: string }[]; salaryLabel?: string; workTypes?: string[];
    workArrangements?: { displayText?: string }; listingDate?: string; listingDateDisplay?: string;
    teaser?: string; bulletPoints?: string[];
    classifications?: { classification?: { id?: string; description?: string }; subclassification?: { id?: string; description?: string } }[];
    isFeatured?: boolean; displayType?: string;
  };
  const facets = data.facets && typeof data.facets === "object"
    ? Object.fromEntries(
        Object.entries(data.facets as Record<string, Array<{ id: string; count: number; label?: { text?: string } }>>).map(
          ([k, list]) => [k, (list ?? []).map((f) => ({ id: f.id, label: f.label?.text ?? null, count: f.count }))],
        ),
      )
    : undefined;
  return {
    total: data.totalCount as number,
    page: Number(q.page),
    where: data.location ? { understoodAs: data.location.description ?? null, whereId: data.location.whereId ?? null } : undefined,
    facets,
    jobs: ((data.data ?? []) as Raw[]).map((j: any) => ({
      id: j.id,
      title: j.title,
      company: j.companyName ?? j.advertiser?.description ?? null,
      advertiserId: j.advertiser?.id ?? null,
      location: j.locations?.map((l: { label: string }) => l.label).join("; ") || null,
      salary: j.salaryLabel || null,
      workType: j.workTypes?.join(", ") || null,
      arrangement: j.workArrangements?.displayText || j.workArrangements?.data?.map((a: any) => a.label?.text).filter(Boolean).join(", ") || null,
      category: j.classifications?.[0]?.subclassification?.description ?? null,
      classificationId: j.classifications?.[0]?.classification?.id ?? null,
      subclassificationId: j.classifications?.[0]?.subclassification?.id ?? null,
      tags: j.tags?.length ? j.tags.map((t: any) => t.label ?? t.type) : undefined,
      listed: j.listingDate ?? null,
      listedAgo: j.listingDateDisplay ?? null,
      promoted: j.isFeatured || j.displayType === "promoted" || undefined,
      teaser: j.teaser || null,
      bullets: j.bulletPoints?.length ? j.bulletPoints : undefined,
      url: `${ORIGIN}/job/${j.id}`,
    })),
  };
}

function extractApolloData(html: string): any {
  const marker = "window.SEEK_APOLLO_DATA";
  const at = html.indexOf(marker);
  if (at < 0) throw new Error("Job page did not contain Seek's job data");
  const eq = html.indexOf("=", at + marker.length);
  if (eq < 0) throw new Error("Malformed SEEK_APOLLO_DATA assignment");
  let i = eq + 1;
  while (i < html.length && /\s/.test(html[i])) i++;
  if (html[i] !== "{") throw new Error(`SEEK_APOLLO_DATA is not an object literal (found ${html[i]})`);
  const start = i;
  let depth = 0;
  let inString = false;
  let quote = "";
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error("SEEK_APOLLO_DATA was never closed");
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|h[1-6])\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function job(id: string) {
  if (!/^\d+$/.test(id)) throw new Error(`Seek job ids are numeric; got "${id}"`);
  const r = await fetch(`${ORIGIN}/job/${id}`, { headers: { "user-agent": UA } });
  if (r.status === 404) throw new Error(`Seek has no job ${id} (404)`);
  if (!r.ok) throw new Error(`Seek returned HTTP ${r.status} for job ${id}`);
  const c = extractApolloData(await r.text());
  const deref = (v: any): any => (v && v.__ref ? c[v.__ref] : v);
  const field = (o: any, name: string): any => {
    if (!o) return undefined;
    if (name in o) return deref(o[name]);
    const k = Object.keys(o).find((key) => key.startsWith(`${name}(`));
    return k ? deref(o[k]) : undefined;
  };
  const key = Object.keys(c.ROOT_QUERY ?? {}).find((k) => k.startsWith("jobDetails:"));
  const j = deref(c.ROOT_QUERY?.[key as string]?.job);
  if (!j) throw new Error(`No details for job ${id} in the page (expired or removed?)`);
  const adv = deref(j.advertiser);
  const cls = (j.classifications ?? []).map(deref).map((x: any) => field(x, "label")).filter(Boolean);
  return {
    id: j.id,
    title: j.title,
    company: field(adv, "name") ?? null,
    advertiserVerified: adv?.isVerified ?? null,
    location: field(deref(j.location), "label") ?? null,
    salary: j.salary ? field(deref(j.salary), "label") ?? null : null,
    workType: field(deref(j.workTypes), "label") ?? null,
    category: cls.join("; ") || null,
    listed: deref(j.listedAt)?.dateTimeUtc ?? null,
    listedLabel: field(deref(j.listedAt), "label") ?? null,
    expiresAt: deref(j.expiresAt)?.dateTimeUtc ?? null,
    status: j.status ?? null,
    expired: j.isExpired ?? null,
    externalApply: j.isLinkOut ?? null,
    abstract: j.abstract ?? null,
    description: htmlToText(field(j, "content2") ?? field(j, "content") ?? ""),
    url: `${ORIGIN}/job/${j.id}`,
  };
}

export interface QuestionOption { id: string; text: string; uri: string | null }
export interface Question {
  id: string;
  text: string;
  kind: "SingleChoiceQuestion" | "MultipleChoiceQuestion" | "PrivacyPolicyQuestion" | string;
  options: QuestionOption[];
  lastAnswer: string | null;
}

const PROCESS_QUERY = `query GetJobApplicationProcess($jobId: ID!, $isAuthenticated: Boolean!) {
  jobApplicationProcess(jobId: $jobId) {
    location { id name }
    classification { id name subClassification { id name } }
    documents {
      lastAppliedResumeIdPrefill @include(if: $isAuthenticated)
      selectionCriteriaRequired
      lastCoverLetterMethod @include(if: $isAuthenticated)
      lastWrittenCoverLetter @include(if: $isAuthenticated) { content }
    }
    questionnaire {
      questions @include(if: $isAuthenticated) {
        id text __typename
        ... on SingleChoiceQuestion { lastAnswer { id } options { id text uri } }
        ... on MultipleChoiceQuestion { lastAnswers { id } options { id text uri } }
        ... on PrivacyPolicyQuestion { url options { id text uri } }
      }
    }
    job { id title advertiser { id name } }
    linkOut
    extractedRoleTitles
  }
}`;

const SAVED_APPLIED_QUERY = `query SearchSavedAndAppliedJobs($jobIds: [String!]!) {
  viewer { searchSavedJobs(jobIds: $jobIds) { jobId } searchAppliedJobs(jobIds: $jobIds) { jobId } }
}`;

export async function savedAndApplied(jobIds: string[]) {
  const data = await gql(SAVED_APPLIED_QUERY, { jobIds });
  const saved = new Set((data.viewer?.searchSavedJobs ?? []).map((j: any) => String(j.jobId)));
  const applied = new Set((data.viewer?.searchAppliedJobs ?? []).map((j: any) => String(j.jobId)));
  return Object.fromEntries(jobIds.map((id) => [id, { saved: saved.has(id), applied: applied.has(id) }]));
}

export async function verificationNudges(jobId: string, selectedAnswerUris: string[] = []) {
  const d = await sgql("GetVerifications", { jobId, selectedAnswerUris, zone: ZONE });
  return [...(d?.viewer?.verificationNudges ?? [])]
    .sort((a: any, b: any) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((n: any) =>
      clean({ rank: n.rank, description: n.description, types: n.verificationType, action: n.ctaLabel, url: n.ctaUrl, uri: n.uri }),
    );
}

export async function applicationProcess(jobId: string, opts: { verificationNudges?: boolean } = {}) {
  if (!/^\d+$/.test(jobId)) throw new Error(`Seek job ids are numeric; got "${jobId}"`);
  const [data, flags, nudges] = await Promise.all([
    gql(PROCESS_QUERY, { jobId, isAuthenticated: true }),
    savedAndApplied([jobId]),
    opts.verificationNudges ? verificationNudges(jobId).catch(() => null) : null,
  ]);
  const p = data.jobApplicationProcess;
  if (!p) throw new Error(`Seek returned no application process for job ${jobId}`);
  const questions: Question[] = (p.questionnaire?.questions ?? []).map((q: any) => ({
    id: q.id,
    text: q.text ?? null,
    kind: q.__typename,
    options: (q.options ?? []).map((o: any) => ({ id: o.id, text: o.text, uri: o.uri ?? null })),
    lastAnswer: q.lastAnswer?.id ?? q.lastAnswers?.[0]?.id ?? null,
  }));
  return {
    jobId,
    jobTitle: p.job?.title ?? null,
    company: p.job?.advertiser?.name ?? null,
    externalApply: !!p.linkOut,
    alreadyApplied: flags[jobId]?.applied ?? false,
    saved: flags[jobId]?.saved ?? false,
    applyPath: p.linkOut ? `${ORIGIN}/job/${jobId}/apply/external` : `${ORIGIN}/job/${jobId}/apply`,
    selectionCriteriaRequired: !!p.documents?.selectionCriteriaRequired,
    lastAppliedResumeId: p.documents?.lastAppliedResumeIdPrefill ?? null,
    lastCoverLetterMethod: p.documents?.lastCoverLetterMethod ?? null,
    questions,
    ...(nudges?.length ? { verificationNudges: nudges } : {}),
  };
}

export async function profile() {
  const data = await gql(`query {
    viewer {
      _id emailAddress
      personalDetails(countryCode: "NZ", languageCode: "en") { firstName lastName phoneNumber }
      currentLocation2(languageCode: "en", zone: "anz-2") { id description }
      resumes { id isDefault fileMetadata { name size virusScanStatus uri } }
      roles(status: confirmed) {
        id title { text } company { text }
        from { year month } to { year month }
      }
    }
  }`);
  const v = data.viewer;
  const roles = (v.roles ?? [])
    .filter((r: any) => r.from?.year)
    .sort((a: any, b: any) => (b.to?.year ?? 9999) - (a.to?.year ?? 9999) || (b.to?.month ?? 1) - (a.to?.month ?? 1));
  return {
    id: v._id,
    email: v.emailAddress,
    firstName: v.personalDetails?.firstName ?? null,
    lastName: v.personalDetails?.lastName ?? null,
    phone: v.personalDetails?.phoneNumber ?? null,
    location: v.currentLocation2?.description ?? null,
    resumes: (v.resumes ?? []).map((r: any) => ({
      id: r.id,
      name: r.fileMetadata?.name ?? null,
      size: r.fileMetadata?.size ?? null,
      virusScanStatus: r.fileMetadata?.virusScanStatus ?? null,
      isDefault: !!r.isDefault,
      uri: r.fileMetadata?.uri ?? null,
    })),
    roles: roles.map((r: any) => ({
      id: r.id,
      title: r.title?.text ?? null,
      company: r.company?.text ?? null,
      from: r.from ?? null,
      to: r.to ?? null,
    })),
  };
}

const SAVED_QUERY = `query GetSavedJobs($first: Int, $locale: Locale!, $zone: Zone!) {
  viewer {
    id
    savedJobs(first: $first) {
      edges { node {
        id isActive notes isExternal
        createdAt { dateTimeUtc }
        job {
          id title abstract
          location { label(locale: $locale, type: SHORT) }
          listedAt { dateTimeUtc }
          advertiser { id name(locale: $locale) }
          salary { label currencyLabel(zone: $zone) }
        }
      } }
    }
  }
}`;

const ACTIVITY_VARS = {
  first: 100,
  locale: "en-NZ",
  timezone: "Pacific/Auckland",
  zone: "anz-2",
};

export async function savedJobs() {
  const data = await gql(SAVED_QUERY, ACTIVITY_VARS);
  return (data.viewer?.savedJobs?.edges ?? []).map(({ node: n }: any) => ({
    id: n.job.id,
    title: n.job.title,
    company: n.job.advertiser?.name ?? null,
    location: n.job.location?.label ?? null,
    salary: n.job.salary?.currencyLabel ?? n.job.salary?.label ?? null,
    listed: n.job.listedAt?.dateTimeUtc ?? null,
    savedAt: n.createdAt?.dateTimeUtc ?? null,
    stillOpen: n.isActive,
    externalApply: n.isExternal,
    notes: n.notes ?? null,
    abstract: n.job.abstract ?? null,
    url: `${ORIGIN}/job/${n.job.id}`,
  }));
}

const APPLIED_QUERY = `query GetAppliedJobs($first: Int, $locale: Locale!, $zone: Zone!, $sortBy: AppliedJobSortByInput) {
  viewer {
    id
    appliedJobs(first: $first, locale: $locale, sortBy: $sortBy) {
      edges { node {
        id hasAppliedWithResume hasAppliedWithCoverLetter isExternal isActive notes
        applicationRequestId isPreferredApplication
        appliedAt { dateTimeUtc }
        events { status timestamp { dateTimeUtc } }
        job {
          id title abstract
          location { label(locale: $locale, type: SHORT) }
          listedAt { dateTimeUtc }
          advertiser { id name(locale: $locale) }
          salary { label currencyLabel(zone: $zone) }
        }
      } }
    }
  }
}`;

export async function appliedJobs() {
  const data = await gql(APPLIED_QUERY, { ...ACTIVITY_VARS, sortBy: { applicationDate: "DESC" } });
  return (data.viewer?.appliedJobs?.edges ?? []).map(({ node: n }: any) => ({
    id: n.job.id,
    title: n.job.title,
    company: n.job.advertiser?.name ?? null,
    location: n.job.location?.label ?? null,
    salary: n.job.salary?.currencyLabel ?? n.job.salary?.label ?? null,
    appliedAt: n.appliedAt?.dateTimeUtc ?? null,
    stillOpen: n.isActive,
    externalApply: n.isExternal,
    withResume: n.hasAppliedWithResume ?? null,
    withCoverLetter: n.hasAppliedWithCoverLetter ?? null,
    preferredApplication: n.isPreferredApplication ?? null,
    applicationRequestId: n.applicationRequestId ?? null,
    status: n.events?.length ? n.events[n.events.length - 1].status : null,
    history: (n.events ?? []).map((e: any) => ({ status: e.status, at: e.timestamp?.dateTimeUtc ?? null })),
    notes: n.notes ?? null,
    url: `${ORIGIN}/job/${n.job.id}`,
  }));
}
