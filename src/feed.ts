import { sgql } from "./auth.js";
import { poll } from "./jobs.js";
import { LOCALE, ORIGIN, PLATFORM, TIMEZONE, VISITOR_ID, ZONE, clean } from "./seek.js";

const COMPONENTS = ["JOB", "COMPANY_EVP", "MARKET_INSIGHTS", "PROFILE_PERFORMANCE_INSIGHTS"];
const COMPONENTS_WITH_CAREER_INSIGHTS = ["JOB", "COMPANY_EVP", "MARKET_INSIGHTS", "CAREER_INSIGHTS", "PROFILE_PERFORMANCE_INSIGHTS"];
const NBQ_EXPERIMENT = { key: "experiment-recs-refinement-nbq", value: "nbq-v2" };
const EXPERIMENTS = [
  { key: "experiment-career-feed-feedback-loops", value: "v2" },
  { key: "experiment-career-feed-profile-performance-analytics", value: "show" },
  NBQ_EXPERIMENT,
];
const CAREER_AGENT_EXPERIMENT = { key: "experiment-career-feed-career-assistant-ai-chat", value: "show" };

const EMPTY_REASONS: Record<string, string> = {
  CareerFeedJobsTimeoutEmptyComponentReason: "Seek timed out building the recommendations; try again shortly",
  CareerFeedEmptyJobsEmptyComponentReason: "Seek has no recommendations for this account yet",
  CareerFeedEmptyJobsWithPreferencesEmptyComponentReason:
    "No recommendations are left after the hidden preferences (seek_job_feedback lists them)",
};

export interface RefinementAnswer {
  id?: string;
  question: string;
  options: string[];
  answers: string[];
}

async function careerFeed(components: string[], refinementToken?: string) {
  const d = await sgql("GetCareerFeed", {
    zone: ZONE,
    visitorId: VISITOR_ID,
    timezone: TIMEZONE,
    locale: LOCALE,
    components,
    enrichmentModel: "LOA",
    enableCareerFeedPreferencesCentre: true,
    experiments: components.includes("CAREER_INSIGHTS") ? [CAREER_AGENT_EXPERIMENT, ...EXPERIMENTS] : EXPERIMENTS,
    context: refinementToken ? { recsRefinementToken: refinementToken } : undefined,
  }, { partialOk: true });
  const feed = d?.careerFeed;
  if (!feed) throw new Error("Seek returned no home feed");
  return { feed, nodes: (feed.edges ?? []).map((e: any) => e?.node).filter(Boolean) as any[] };
}

const ofType = (nodes: any[], type: string) => nodes.filter((n) => n.__typename === type);

const shapeJob = (n: any) => {
  const id = n.job?.id ?? n.jobId;
  return clean({
    id,
    title: n.job?.title,
    company: n.job?.advertiser?.name,
    location: n.job?.location?.label,
    salary: n.job?.salary?.currencyLabel ?? n.job?.salary?.label,
    workType: n.job?.workTypes?.label,
    arrangement: n.workArrangements?.label,
    listed: n.job?.listedAt?.label,
    saved: !!n.savedJob,
    badges: n.jobBadges?.badgeDetails?.map((b: any) => b?.displayText),
    summary: n.enrichment?.summary,
    notInterestedReasons: n.feedbackReasons?.reasons
      ?.filter((r: any) => r?.saveJobPreferencesArgs?.typeId)
      .map((r: any) => ({ reason: r.saveJobPreferencesArgs.reason ?? r.reason, typeId: r.saveJobPreferencesArgs.typeId, label: r.displayText ?? r.label })),
    url: id ? `${ORIGIN}/job/${id}` : undefined,
  });
};

const recsTokenOf = (feed: any, nodes: any[]) => ofType(nodes, "CareerFeedJob")[0]?.serviceToken ?? feed.serviceToken;

async function marketTrend(roleUri: string, locationId: string | number) {
  const d = (await sgql("CareerFeedInsights", {
    roleTitleId: roleUri, locationId: String(locationId), locale: LOCALE, visitorId: VISITOR_ID, zone: ZONE,
  }, { partialOk: true }))?.careerFeedInsights;
  if (!d) return null;
  return clean({
    openRoles: d.adVolumeShift ? { count: d.adVolumeShift.count, days: d.adVolumeShift.dayRange } : undefined,
    legend: d.adVolumeData?.chartLegend,
    adsPosted: d.adVolumeData?.dataPoints?.map((p: any) =>
      clean({ from: p.startDateLabel?.shortAbsoluteLabel, to: p.endDateLabel?.shortAbsoluteLabel, ads: p.adsPostedCount }),
    ),
  });
}

async function profileActivity(durationInDays?: number) {
  const v = (await sgql("CareerFeedProfilePerformanceInsightsSummary", { locale: LOCALE, input: { durationInDays } }, { partialOk: true }))?.viewer;
  const s = v?.careerFeedProfilePerformanceInsightsSummary;
  if (!s) return null;
  return clean({
    label: s.label,
    days: s.durationInDays,
    profileVisibility: v.profileVisibility2?.name,
    activities: s.activities?.map((a: any) =>
      clean({
        activity: a.activity,
        label: a.label,
        description: a.description,
        count: (a.entries ?? []).reduce((total: number, e: any) => total + (e?.count ?? 0), 0),
      }),
    ),
  });
}

const shapePerformance = (item: any) =>
  item?.__typename === "CareerFeedProfilePerformanceInsightsActivitiesItem"
    ? clean({
        metric: /Searches/.test(item.data?.__typename ?? "") ? "searches" : "views",
        count: item.data?.count,
        days: item.durationInDays,
        refreshed: item.lastRefreshedAt?.shortAbsoluteLabel,
      })
    : item?.__typename === "CareerFeedProfilePerformanceInsightsProfileUpdateItem"
      ? clean({ suggestion: item.kind })
      : undefined;

const shapeMarket = (m: any) =>
  m
    ? clean({
        role: m.role ? { title: m.role.roleTitle, uri: m.role.uri } : undefined,
        location: m.location ? { id: Number(m.location.id) || m.location.id, label: m.location.label } : undefined,
      })
    : null;

export async function salaryNudge() {
  const n = (await sgql("GetSalaryNudge", { zone: ZONE }, { partialOk: true }))?.viewer?.salaryNudge;
  return n
    ? clean({
        nudgeId: n.id,
        prompt: n.prompt,
        text: n.text,
        options: (n.callToActions ?? []).map((c: any) => ({ label: c.displayText, option: c.operation })),
      })
    : null;
}

const pageOf = <T>(items: T[], page = 1, pageSize = 20) => items.slice((page - 1) * pageSize, page * pageSize);

export async function homeFeed(o: {
  refinementToken?: string;
  careerInsights?: boolean;
  market?: { roleUri: string; locationId: number };
  page?: number;
  pageSize?: number;
} = {}) {
  const [{ feed, nodes }, nudge] = await Promise.all([
    careerFeed(o.careerInsights ? COMPONENTS_WITH_CAREER_INSIGHTS : COMPONENTS, o.refinementToken),
    salaryNudge().catch(() => null),
  ]);
  const market = ofType(nodes, "CareerFeedPersonalMarketInsights")[0];
  const performance = ofType(nodes, "CareerFeedProfilePerformanceInsights")[0]?.item;
  const trendFor = o.market ?? (market?.role?.uri && market?.location?.id ? { roleUri: market.role.uri, locationId: market.location.id } : null);
  const [trend, activity] = await Promise.all([
    trendFor ? marketTrend(trendFor.roleUri, trendFor.locationId).catch((e) => ({ error: (e as Error).message })) : null,
    profileActivity(performance?.durationInDays).catch(() => null),
  ]);
  const jobs = ofType(nodes, "CareerFeedJob");
  return clean({
    serviceToken: feed.serviceToken,
    recsServiceToken: recsTokenOf(feed, nodes),
    refinementToken: o.refinementToken,
    marketInsights: market || o.market
      ? clean({ ...shapeMarket(market), trendFor: o.market, trend })
      : undefined,
    profilePerformance: performance || activity ? clean({ ...shapePerformance(performance), activity }) : undefined,
    salaryNudge: nudge,
    careerInsights: ofType(nodes, "CareerFeedCareerInsights").map((n) =>
      clean({
        label: n.label,
        role: n.role?.roleTitle,
        location: n.location?.label,
        suggestions: n.suggestions?.map((s: any) => clean({ title: s.title, content: s.content })),
      }),
    ),
    inflowModules: ofType(nodes, "CareerFeedPersonalisedInflowModule").map((n) =>
      clean({ id: n.id, variant: n.variant, label: n.label, cta: n.ctaLabel, prompt: n.prompt?.value || n.prompt?.label }),
    ),
    companies: ofType(nodes, "CareerFeedCompanyEvp").map((n) =>
      clean({
        companyId: n.companyId,
        name: n.companyProfile?.data?.name,
        reviewSummary: n.companyReviewsAISummary?.aISummaryContent?.positiveAndChallengesSummary,
        url: n.companyProfile?.data?.canonicalUrl,
      }),
    ),
    jobsNote: EMPTY_REASONS[feed.emptyComponentReason?.__typename ?? ""],
    totalJobs: jobs.length,
    page: o.page ?? 1,
    jobs: pageOf(jobs, o.page, o.pageSize).map(shapeJob),
  });
}

const nbqInput = (recsServiceToken: string) => ({
  channel: "HOME", platform: PLATFORM, visitorId: VISITOR_ID, zone: ZONE, recsServiceToken, experiments: [NBQ_EXPERIMENT],
});

async function nextQuestions(recsServiceToken: string, previousItem?: RefinementAnswer) {
  const ask = async (extra: Record<string, unknown>) =>
    (await sgql("CareerFeedJobsNextBestQuestion", { input: { ...nbqInput(recsServiceToken), ...extra } }))
      ?.careerFeedJobsNextBestQuestion?.status ?? null;
  const status = await poll(
    await ask(previousItem ? { previousItem } : {}),
    (s: any) => ask({ serviceToken: String(s.serviceToken) }),
    (s: any) => (s?.__typename === "CareerFeedJobsNextBestQuestionStatusInProgress" ? s.waitForMs ?? 1000 : null),
  );
  if (status?.__typename === "CareerFeedJobsNextBestQuestionStatusInProgress") {
    return { recsServiceToken, pending: true, note: "Seek is still preparing its questions; call again in a moment." };
  }
  const questions = (status?.questions ?? []).map((q: any) =>
    clean({
      id: q.id,
      question: q.question,
      options: (q.options ?? []).map((x: any) => x.value),
      freeText: (q.options ?? []).find((x: any) => x.__typename === "CareerFeedJobsNextBestQuestionTextInputOption")?.value,
    }),
  );
  return clean({
    recsServiceToken,
    questions,
    note: questions.length ? undefined : "Seek has no questions for these recommendations right now.",
  });
}

async function submitRefinement(recsServiceToken: string, answers: RefinementAnswer[]) {
  const items = answers.map((a) => clean({ id: a.id, question: a.question, options: a.options, answers: a.answers }));
  const r = (await sgql("SubmitCareerFeedJobsRefinement", {
    input: { channel: "HOME", items, platform: PLATFORM, recsServiceToken, visitorId: VISITOR_ID, zone: ZONE },
  }))?.submitCareerFeedJobsRefinement;
  if (!r?.status?.refinementToken) throw new Error("Seek did not accept the refinement");
  const status = await poll(
    r.status,
    async (s: any) =>
      (await sgql("GetCareerFeedRecsRefinementStatus", { refinementToken: s.refinementToken }))?.careerFeedJobsRefinementStatus ?? s,
    (s: any) => (s.__typename === "CareerFeedJobsRefinementStatusInProgress" ? s.waitForMs ?? 1000 : null),
  );
  const refinementToken = status.refinementToken;
  if (status.__typename === "CareerFeedJobsRefinementStatusInProgress") {
    return {
      refined: false,
      refinementToken,
      note: "Seek accepted the answers and is still re-ranking; seek_home_feed with this refinementToken shows the result.",
    };
  }
  const { nodes } = await careerFeed(["JOB"], refinementToken);
  const jobs = ofType(nodes, "CareerFeedJob");
  return {
    refined: true,
    refinementToken,
    answered: items.length,
    totalJobs: jobs.length,
    jobs: pageOf(jobs).map(shapeJob),
    more: jobs.length > 20 ? "seek_home_feed with this refinementToken pages through the rest" : undefined,
  };
}

export async function refineRecommendations(p: { recsServiceToken?: string; answers?: RefinementAnswer[]; followUp?: boolean } = {}) {
  let recsServiceToken = p.recsServiceToken?.trim();
  if (!recsServiceToken) {
    const { feed, nodes } = await careerFeed(["JOB"]);
    recsServiceToken = recsTokenOf(feed, nodes);
  }
  if (!recsServiceToken) throw new Error("Seek returned no recommendations to refine");
  if (!p.answers?.length) return nextQuestions(recsServiceToken);
  if (p.followUp) return nextQuestions(recsServiceToken, p.answers[p.answers.length - 1]);
  return submitRefinement(recsServiceToken, p.answers);
}

async function marketInsightsChoice() {
  const { nodes } = await careerFeed(["MARKET_INSIGHTS"]);
  return shapeMarket(ofType(nodes, "CareerFeedPersonalMarketInsights")[0]);
}

export async function homeNudges(p: {
  salaryAnswer?: { nudgeId: string; option: string };
  marketInsights?: { roleUri: string; locationId: number };
  confirmProfileUpToDate?: boolean;
} = {}) {
  const changed: Record<string, unknown> = {};
  if (p.salaryAnswer) {
    await sgql("AddSalaryNudgeFeedback", { nudgeId: p.salaryAnswer.nudgeId, nudgeOption: p.salaryAnswer.option, zone: ZONE });
    changed.salaryNudgeAnswered = p.salaryAnswer;
  }
  if (p.marketInsights) {
    await sgql("UpdateMarketInsightsPreferences", {
      input: { role: { uri: p.marketInsights.roleUri }, location: { id: String(p.marketInsights.locationId) } },
    });
    changed.marketInsights = p.marketInsights;
  }
  if (p.confirmProfileUpToDate) {
    const r = await sgql("ConfirmProfileUpToDate");
    changed.profileConfirmedUpToDate = r?.confirmProfileUpToDate?.confirmedDate?.dateTimeUtc ?? true;
  }
  const afterChange = Object.keys(changed).length > 0;
  const [nudge, market] = await Promise.all([
    salaryNudge().catch((e) => {
      if (afterChange) return undefined;
      throw e;
    }),
    marketInsightsChoice().catch(() => undefined),
  ]);
  return clean({
    changed: afterChange ? changed : undefined,
    salaryNudge: nudge === null ? "none showing" : nudge,
    marketInsights: market,
  });
}
