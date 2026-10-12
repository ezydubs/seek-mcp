import { randomUUID } from "node:crypto";
import { searchFilters } from "./api.js";
import { NotLoggedInError, isSignedIn, sgql } from "./auth.js";
import {
  COUNTRY, LANGUAGE, LOCALE, ORIGIN, PLATFORM, SESSION_ID, TIMEZONE, UA, VISITOR_ID, ZONE, assertJobId, clean, htmlToText,
  publicGql,
} from "./seek.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function poll<T>(
  first: T,
  next: (current: T) => Promise<T>,
  waitFor: (current: T) => number | null | undefined,
  budgetMs = 40_000,
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  let current = first;
  for (let round = 0; round < 30; round++) {
    const ms = waitFor(current);
    if (ms == null) return current;
    const wait = Math.min(Math.max(ms, 250), 5_000);
    if (Date.now() + wait > deadline) return current;
    await sleep(wait);
    current = await next(current);
  }
  return current;
}

const detailVars = (jobId: string, isAuthenticated: boolean) => ({
  jobId,
  jobDetailsViewedCorrelationId: randomUUID(),
  sessionId: SESSION_ID,
  zone: ZONE,
  locale: LOCALE,
  languageCode: LANGUAGE,
  countryCode: COUNTRY,
  timezone: TIMEZONE,
  visitorId: VISITOR_ID,
  isAuthenticated,
  enableJdvBadge: true,
  enableClickToReveal: false,
  enableSalaryTransparencyOptimisation: isAuthenticated,
});

export async function jobDetails(id: string) {
  const jobId = assertJobId(id);
  let d: any;
  let signedIn = false;
  if (isSignedIn()) {
    try {
      d = (await sgql("jobDetails", detailVars(jobId, true), { partialOk: true }))?.jobDetails;
      signedIn = true;
    } catch (e) {
      if (!(e instanceof NotLoggedInError)) throw e;
    }
  }
  if (!signedIn) d = (await publicGql("jobDetails", detailVars(jobId, false), { partialOk: true }))?.jobDetails;
  if (!d?.job) return null;
  const j = d.job;
  const cp = d.companyProfile;
  const insights = (Array.isArray(d.insights) ? d.insights : [d.insights]).filter(Boolean);
  return clean({
    id: j.id,
    title: j.title,
    company: j.advertiser?.name ?? null,
    advertiserId: j.advertiser?.id ?? null,
    advertiserVerified: j.advertiser?.isVerified ?? null,
    advertiserRegistered: j.advertiser?.registrationDate?.dateTimeUtc ?? null,
    location: j.location?.label ?? null,
    locationIds: j.tracking?.locationInfo?.locationIds,
    salary: j.salary?.currencyLabel ?? j.salary?.label ?? null,
    workType: j.workTypes?.label ?? null,
    workArrangement: d.workArrangements?.label ?? null,
    category: j.classifications?.map((c: any) => c.label).join("; ") || null,
    classificationId: j.tracking?.classificationInfo?.classificationId,
    subclassificationId: j.tracking?.classificationInfo?.subClassificationId,
    listed: j.listedAt?.dateTimeUtc ?? null,
    listedLabel: j.listedAt?.label ?? null,
    expiresAt: j.expiresAt?.dateTimeUtc ?? null,
    status: j.status ?? null,
    expired: j.isExpired ?? null,
    externalApply: j.isLinkOut ?? null,
    verifiedAd: j.isVerified ?? null,
    abstract: j.abstract ?? null,
    bullets: j.products?.bullets,
    badges: d.badges?.badges?.map((b: any) => b.message ? `${b.displayText}: ${b.message}` : b.displayText),
    applicants: insights.length ? insights.map((i: any) => i.volumeLabel ?? i.count) : undefined,
    phone: j.phoneNumber ?? null,
    contactDetails: j.contactMatches?.map((c: any) => `${c.type}: ${c.value}`),
    employerQuestions: j.products?.questionnaire?.questions,
    video: j.products?.video?.url,
    restriction: d.restrictedApplication?.label ?? null,
    salaryMatch: d.salaryMatch?.salaryMatchResult
      ? { eligibility: d.salaryMatch.jobSalaryMatchEligibility, ...d.salaryMatch.salaryMatchResult }
      : undefined,
    companyProfile: cp
      ? {
          id: cp.id,
          name: cp.name,
          slug: cp.companyNameSlug,
          rating: cp.reviewsSummary?.overallRating?.value,
          reviews: cp.reviewsSummary?.overallRating?.numberOfReviews?.value,
          industry: cp.overview?.industry,
          size: cp.overview?.size?.description,
          website: cp.overview?.website?.url,
          perks: cp.perksAndBenefits?.map((p: any) => p.title),
        }
      : undefined,
    companyTags: d.companyTags?.map((t: any) => `${t.key}: ${t.value}`),
    description: htmlToText(j.content),
    shareLink: j.shareLink,
    url: `${ORIGIN}/job/${j.id}`,
    personalised: signedIn,
  });
}

export async function similarJobs(id: string) {
  const jobId = assertJobId(id);
  const data = await publicGql("JobDetailsRecommendedJobs", {
    jobDetailsId: jobId,
    zone: ZONE,
    platform: "WEB",
    visitorId: VISITOR_ID,
    context: "JOB_POSTED",
    length: "SHORT",
    timezone: TIMEZONE,
    locale: LOCALE,
  });
  return (data?.jobDetails?.recommendedJobs ?? []).map((r: any) =>
    clean({
      id: r.job?.id,
      title: r.job?.title,
      company: r.job?.advertiser?.name,
      location: r.job?.location?.label,
      listed: r.job?.listedAt?.label,
      url: r.job?.id ? `${ORIGIN}/job/${r.job.id}` : undefined,
    }),
  );
}

const shapeMatch = (m: any) =>
  m && m.__typename !== "CandidateJobMatchNotExists"
    ? clean({
        state: m.__typename?.replace(/^CandidateJobMatch|^CreateCandidateJobMatch/, "") || null,
        shouldApply: m.shouldApply,
        verdict: m.shouldApplyMessage,
        summary: m.summary,
        recommendations: m.recommendations,
        createdAt: m.createdAt,
        retryInMs: m.waitForMs,
        retryAfter: m.retryAfter,
        message: m.message,
        qualifiers: m.qualifiers,
      })
    : null;

const fitState = (f: any): string | undefined =>
  f.__typename?.replace(/^(?:Create)?CandidateJobMatch(?:StrongFit|StandOut)/, "") ||
  (f.matchStrengths != null || f.threeWaysToStandOut != null || f.personalSummary != null ? "Exists"
    : f.waitForMs != null ? "InProgress"
    : f.qualifiers ? "NotEligible"
    : f.retryAfter ? "AllocationExhausted"
    : f.createdAt ? "ResultInvalid"
    : f.message ? "Unavailable"
    : undefined);

const shapeFit = (f: any) =>
  f
    ? clean({
        state: fitState(f),
        matchStrengths: f.matchStrengths,
        threeWaysToStandOut: f.threeWaysToStandOut,
        personalSummary: f.personalSummary,
        createdAt: f.createdAt,
        retryInMs: f.waitForMs,
        retryAfter: f.retryAfter,
        message: f.message,
        qualifiers: f.qualifiers,
      })
    : null;

type Fit = "strongFit" | "standOut";

async function readFit(jobId: string, which: Fit) {
  const d = await sgql(which === "strongFit" ? "CandidateJobMatchStrongFit" : "CandidateJobMatchStandOut", { jobDetailsId: jobId }, { partialOk: true });
  return d?.jobDetails?.personalised?.fit?.[which] ?? null;
}

export async function jobInsights(id: string) {
  const jobId = assertJobId(id);
  const [pers, skills, match, detail, strongFit, standOut] = await Promise.all([
    sgql("jobDetailsPersonalised", {
      id: jobId, zone: ZONE, locale: LOCALE, languageCode: LANGUAGE, timezone: TIMEZONE,
      enableGetCandidateJobMatch: true, enableSalaryTransparencyOptimisation: true, enableCandidateAgentSuggestions: true,
    }, { partialOk: true }),
    sgql("GetMatchedQualities", { jobDetailsId: jobId, locale: LOCALE }, { partialOk: true }).catch(() => null),
    sgql("CandidateJobMatch", { jobDetailsId: jobId, enableGetAllocation: true }, { partialOk: true }).catch(() => null),
    sgql("GetAppliedJobDetail", { jobId, locale: LOCALE }, { partialOk: true }).catch(() => null),
    readFit(jobId, "strongFit").catch(() => null),
    readFit(jobId, "standOut").catch(() => null),
  ]);
  const p = pers?.jobDetails?.personalised ?? {};
  const ms = skills?.jobDetails?.personalised?.matchedSkills;
  const label = (q: any) => q.displayLabel;
  const sm = pers?.jobDetails?.salaryMatch;
  return clean({
    jobId,
    saved: p.isSaved ?? null,
    applied: p.appliedJob?.label ?? p.appliedDateTime?.shortAbsoluteLabel ?? null,
    skills: ms
      ? { matched: ms.matched?.map(label), inferred: ms.inferred?.map(label), missing: ms.unmatched?.map(label) }
      : undefined,
    salaryMatch: sm ? { eligibility: sm.jobSalaryMatchEligibility, ...sm.salaryMatchResult } : undefined,
    jobMatch: shapeMatch(match?.jobDetails?.personalised?.candidateJobMatch ?? p.candidateJobMatch),
    jobMatchAllowance: match?.viewer?.candidateJobMatchAllocation?.message,
    strongFit: shapeFit(strongFit),
    standOut: shapeFit(standOut),
    seekSuggestions: p.candidateAgentSuggestions,
    applicants: (detail?.jobDetails?.insights ?? []).map((i: any) => i.message ?? i.count ?? i.percentage),
    documentsSent: detail?.viewer?.appliedJob?.documents
      ? {
          resume: detail.viewer.appliedJob.documents.resume?.attachmentMetadata?.fileName,
          coverLetter: detail.viewer.appliedJob.documents.coverLetter?.attachmentMetadata?.fileName,
        }
      : undefined,
  });
}

export async function requestJobMatch(id: string) {
  const jobId = assertJobId(id);
  const data = await sgql("createCandidateJobMatchRequest", {
    input: { jobId, channel: "chalice", platform: "WEB", visitorId: VISITOR_ID },
  });
  return { jobId, ...shapeMatch(data?.createCandidateJobMatchRequest) };
}

export async function requestJobFit(id: string, want: { strongFit?: boolean; standOut?: boolean }) {
  const jobId = assertJobId(id);
  const input = { jobId, experimentContext: { channel: "chalice", platform: PLATFORM, visitorId: VISITOR_ID, language: LANGUAGE } };
  const deadline = Date.now() + 40_000;
  const settle = (which: Fit, first: any) => poll(first, () => readFit(jobId, which), (f) => f?.waitForMs, deadline - Date.now());
  const out: Record<string, unknown> = { jobId };
  let strong: any = null;
  if (want.strongFit) {
    strong = await settle(
      "strongFit",
      (await sgql("createCandidateJobMatchStrongFitRequest", { input }))?.createCandidateJobMatchStrongFitRequest ?? null,
    );
    out.strongFit = shapeFit(strong);
  }
  if (want.standOut) {
    out.standOut = want.strongFit && strong?.matchStrengths == null
      ? { state: "NotRequested", message: "Stand out needs a finished strong fit, and this strong-fit request has none (see strongFit)" }
      : shapeFit(await settle(
          "standOut",
          (await sgql("createCandidateJobMatchStandOutRequest", { input }))?.createCandidateJobMatchStandOutRequest ?? null,
        ));
  }
  return clean(out);
}

export async function searchRefinements(query: string, where?: string, count?: number) {
  const keywords = query.trim();
  if (!keywords) throw new Error("Give the search keywords to refine");
  const url = new URL("/api/jobsearch/v5/search", ORIGIN);
  const params = { siteKey: "NZ-Main", locale: LOCALE, page: "1", pageSize: "20", ...searchFilters({ keywords, where }), include: "asyncpills,pills" };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": UA } });
  if (!r.ok) throw new Error(`Seek search returned HTTP ${r.status}`);
  const s = (await r.json()) as any;
  const token = s?.suggestions?.asyncPillsToken;
  const assist = token
    ? (await publicGql("GetJobSearchAssist", { visitorId: VISITOR_ID, tokens: [token] }, { partialOk: true }))
        ?.jobSearchAssist?.pills?.data ?? []
    : [];
  const pill = (p: any) => clean({ label: p.label, keywords: p.keywords, active: p.isActive || undefined, stateToken: p.stateToken });
  return clean({
    keywords,
    where: s?.location?.description,
    jobs: s?.totalCount,
    searchAssist: assist.slice(0, count).map(pill),
    related: (s?.suggestions?.pills ?? []).slice(0, count).map(pill),
  });
}

export const REPORT_REASONS = ["Fraudulent", "Discrimination", "Misleading", "SalaryBelowMinimumWage"] as const;

export async function reportJob(p: { id: string; reason: (typeof REPORT_REASONS)[number]; comment: string; email: string }) {
  const jobId = assertJobId(p.id);
  const comment = p.comment.trim();
  if (!comment) throw new Error("Seek needs a comment explaining the report");
  if (comment.length > 400) throw new Error(`Seek allows 400 characters of comment; this has ${comment.length}`);
  const data = isSignedIn()
    ? await sgql("CreateReportedJob", { report: { jobId: Number(jobId), reason: p.reason, comment, email: p.email, country: COUNTRY } })
    : await publicGql("CreateReportedJob", { report: { jobId: Number(jobId), reason: p.reason, comment, email: p.email, country: COUNTRY } });
  const success = !!data?.reportJob?.success;
  if (!success) throw new Error("Seek did not accept the report");
  return { jobId, reported: true, reason: p.reason };
}
