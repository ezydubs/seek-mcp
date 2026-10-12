import { sgql } from "./auth.js";
import { appliedJobs, searchFilters, type SearchParams } from "./api.js";
import { LANGUAGE, LOCALE, ORIGIN, TIMEZONE, VISITOR_ID, ZONE, assertJobId, clean } from "./seek.js";

const shapeSearch = (s: any) =>
  clean({
    id: s.id,
    name: s.name,
    newJobs: s.newToYouCountLabel ?? s.countLabel,
    emailAlerts: s.subscribeToNewJobs,
    created: s.createdDate?.shortAbsoluteLabel,
    query: s.query?.searchQueryString,
    filters: Object.fromEntries((s.query?.parameters ?? []).map((p: any) => [p.type, p.value])),
    url: s.query?.searchQueryString ? `${ORIGIN}/jobs?${s.query.searchQueryString}` : undefined,
  });

export async function savedSearches() {
  const d = await sgql("GetSavedSearches", { locale: LOCALE, languageCode: LANGUAGE });
  return (d?.viewer?.apacSavedSearches ?? []).map(shapeSearch);
}

export async function createSavedSearch(p: SearchParams) {
  const filters = searchFilters(p);
  if (!Object.keys(filters).length) throw new Error("A saved search needs at least one filter (keywords, where, classification…)");
  const d = await sgql("CreateApacSavedSearch", {
    input: { searchQueryString: new URLSearchParams(filters).toString(), zone: ZONE },
    languageCode: LANGUAGE,
    locale: LOCALE,
  });
  const r = d?.createApacSavedSearch;
  if (r?.error) throw new Error(`Seek would not save the search: ${r.error.message}`);
  return { saved: true, search: shapeSearch(r?.savedSearch ?? {}) };
}

export async function deleteSavedSearch(id: string) {
  const r = (await sgql("DeleteApacSavedSearch", { input: { id }, locale: LOCALE }))?.deleteApacSavedSearch;
  if (r?.errors?.length) throw new Error(`Seek would not delete saved search ${id}: ${r.errors[0].message}`);
  return { deleted: id };
}

export async function setSavedSearchAlerts(id: string, emailAlerts: boolean) {
  const r = (await sgql("UpdateSavedSearchEmailAlert", { id, allowEmailAlert: emailAlerts, locale: LOCALE }))
    ?.subscribeApacSavedEmailAlert;
  if (r?.errors?.length) throw new Error(`Seek would not change the alert: ${r.errors[0].message}`);
  return { id, emailAlerts };
}

export async function setJobNote(p: { id: string; list: "saved" | "applied"; note: string | null }) {
  const id = assertJobId(p.id);
  const text = p.note?.trim();
  if (p.list === "saved") {
    if (text) await sgql("SetSavedJobNotes", { input: { id, notes: text }, locale: LOCALE });
    else await sgql("RemoveSavedJobNotes", { jobId: id, locale: LOCALE });
  } else {
    if (text) await sgql("SetAppliedJobNotes", { input: { id, notes: text }, locale: LOCALE });
    else await sgql("RemoveAppliedJobNotes", { jobId: id, locale: LOCALE });
  }
  return { jobId: id, list: p.list, note: text || null };
}

export async function applicationDetail(jobIdArg: string) {
  const jobId = assertJobId(jobIdArg);
  const [detail, resume, letter] = await Promise.all([
    sgql("GetAppliedJobDetail", { jobId, locale: LOCALE }, { partialOk: true }),
    sgql("GetResumeLink", { jobId }, { partialOk: true }).catch(() => null),
    sgql("GetCoverLetterLink", { jobId }, { partialOk: true }).catch(() => null),
  ]);
  const docs = detail?.viewer?.appliedJob?.documents;
  if (!detail?.viewer?.appliedJob) throw new Error(`No application to job ${jobId} on this account (see seek_applied_jobs)`);
  return clean({
    jobId,
    resume: docs?.resume
      ? { file: docs.resume.attachmentMetadata?.fileName, downloadLink: resume?.viewer?.appliedJob?.documents?.resume?.downloadLink }
      : undefined,
    coverLetter: docs?.coverLetter
      ? { file: docs.coverLetter.attachmentMetadata?.fileName, downloadLink: letter?.viewer?.appliedJob?.documents?.coverLetter?.downloadLink }
      : undefined,
    applicantInsights: (detail?.jobDetails?.insights ?? []).map((i: any) => i.message ?? i.count ?? i.percentage),
  });
}

export async function removeAppliedJob(jobIdArg: string) {
  const id = assertJobId(jobIdArg);
  const r = (await sgql("DeleteAppliedJob", { input: { id }, locale: LOCALE }))?.deleteAppliedJob;
  if (r?.errors?.length) throw new Error(`Seek would not remove job ${id}: ${r.errors[0].message}`);
  return { jobId: id, removedFromList: true, note: "The employer still has the application; Seek offers no withdrawal." };
}

export async function priorityApplyCredit() {
  const d = await sgql("GetPriorityApplyCredit", {
    locale: LOCALE, timezone: TIMEZONE, zone: ZONE, languageCode: LANGUAGE, showStrongInterestEndState: true,
  }, { partialOk: true });
  const c = d?.priorityApplyCredit;
  return clean({
    state: c?.credit2?.__typename === "PrioritizedCredit" ? "Prioritized" : c?.credit2 ? "Pending" : undefined,
    creditsLeft: c?.credit2?.remainingCount,
    of: c?.credit2?.totalCredit,
    renews: c?.credit2?.nextRenewalDate?.shortAbsoluteLabel,
    perPeriod: c?.creditConfig?.creditValue,
    period: c?.creditConfig?.renewFrequency ? `${c.creditConfig.renewFrequency.value} ${c.creditConfig.renewFrequency.unit}` : undefined,
  });
}

export async function markPreferredApplication(jobIdArg: string) {
  const jobId = assertJobId(jobIdArg);
  const app = (await appliedJobs()).find((a: any) => a.id === jobId);
  if (!app) throw new Error(`No application to job ${jobId} on this account (see seek_applied_jobs)`);
  if (!app.applicationRequestId) throw new Error(`Seek has no application request id for job ${jobId}, so it cannot be prioritised`);
  const d = await sgql("MarkAsPreferredApplication", {
    input: { applicationRequestId: app.applicationRequestId, state: (await priorityApplyCredit()).state ?? "Pending" }, locale: LOCALE, timezone: TIMEZONE,
  });
  const r = d?.markAsPreferredApplication;
  if (r?.errors?.length) throw new Error(`Seek would not prioritise the application: ${r.errors[0].message}`);
  return clean({ jobId, prioritised: true, creditsLeft: r?.credit?.remainingCount, of: r?.credit?.totalCredit, renews: r?.credit?.nextRenewalDate?.shortAbsoluteLabel });
}

export async function recommendedJobs() {
  const d = await sgql("GetRecommendedJobs", {
    zone: ZONE, visitorId: VISITOR_ID, timezone: TIMEZONE, locale: LOCALE, components: ["JOB"],
    enrichmentModel: null, enableCareerFeedPreferencesCentre: true,
  }, { partialOk: true });
  const feed = d?.careerFeed;
  return (feed?.edges ?? [])
    .map((e: any) => e.node)
    .filter((n: any) => n?.job)
    .map((n: any) =>
      clean({
        id: n.job.id,
        title: n.job.title,
        company: n.job.advertiser?.name,
        location: n.job.location?.label,
        salary: n.job.salary?.currencyLabel ?? n.job.salary?.label,
        workType: n.job.workTypes?.label,
        arrangement: n.workArrangements?.label,
        listed: n.job.listedAt?.label,
        saved: !!n.savedJob,
        badges: n.jobBadges?.badgeDetails?.map((b: any) => b.displayText),
        summary: n.enrichment?.summary,
        notInterestedReasons: n.feedbackReasons?.reasons?.map((r: any) => ({
          reason: r.saveJobPreferencesArgs?.reason ?? r.reason,
          typeId: r.saveJobPreferencesArgs?.typeId,
          label: r.displayText ?? r.label,
        })),
        url: `${ORIGIN}/job/${n.job.id}`,
      }),
    );
}

export async function jobPreferences() {
  const d = await sgql("CandidateJobPreferences", { locale: LOCALE });
  return (d?.viewer?.candidateJobPreferences ?? []).map((p: any) =>
    clean({ reason: p.reason, label: p.label, items: (p.items ?? []).map((i: any) => ({ id: i.id, typeId: i.typeId, label: i.label })) }),
  );
}

export async function updateJobPreferences(p: { hide?: Array<{ reason: string; typeId: string }>; unhide?: string[] }) {
  if (p.hide?.length) await sgql("SaveJobPreference", { input: p.hide.map((h) => ({ reason: h.reason, typeId: h.typeId })), locale: LOCALE });
  if (p.unhide?.length) {
    const r = (await sgql("DeleteJobPreferences", { input: p.unhide.map((id) => ({ id })), locale: LOCALE }))?.deleteJobPreferences;
    if (r?.error) throw new Error(`Seek would not remove the preference: ${r.error.message}`);
  }
  return { preferences: await jobPreferences() };
}

