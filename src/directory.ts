import { NotLoggedInError, isSignedIn, sgql } from "./auth.js";
import { COUNTRY, LOCALE, ORIGIN, VISITOR_ID, clean, publicGql } from "./seek.js";

const DIRECTORY_COUNTRY = "New Zealand";

const call = (name: Parameters<typeof publicGql>[0], vars: Record<string, unknown>, headers?: Record<string, string>) =>
  isSignedIn()
    ? sgql(name, vars, { partialOk: true }).catch(() => publicGql(name, vars, { partialOk: true, headers }))
    : publicGql(name, vars, { partialOk: true, headers });

const personRow = (n: any) =>
  clean({
    slug: n.slug,
    name: [n.firstName, n.lastName].filter(Boolean).join(" ") || undefined,
    location: n.homeLocation?.label,
    verified: n.digitalIdentity?.isVerified || n.hasVerifiedCredentials || undefined,
    roles: n.workHistories?.map((w: any) => clean({ title: w.roleTitle, company: w.companyName, duration: w.duration?.label })),
    url: n.slug ? `${ORIGIN}/profile/${n.slug}` : undefined,
  });

export async function searchPeople(p: {
  query: string; roleTitles?: string[]; companies?: string[]; locations?: string[]; latestOnly?: boolean; page?: number; pageSize?: number;
}) {
  const d = await call("PublicProfileSearch", {
    input: {
      searchQuery: p.query,
      market: COUNTRY,
      pageNumber: p.page ?? 1,
      pageSize: Math.min(p.pageSize ?? 20, 50),
      locations: { values: p.locations ?? [] },
      roleTitles: { values: p.roleTitles ?? [], matchLatestOnly: !!p.latestOnly },
      companies: { values: p.companies ?? [], matchLatestOnly: !!p.latestOnly },
      visitorId: VISITOR_ID,
    },
    locale: LOCALE,
  }, { "x-visitor-id": VISITOR_ID, "x-channel": "web" });
  const r = d?.publicProfileSearch;
  return clean({
    exactMatches: (r?.exactMatches ?? []).map((e: any) => personRow(e.node)),
    partialMatches: (r?.partialMatches ?? []).map((e: any) => personRow(e.node)),
    page: p.page ?? 1,
  });
}

export async function personProfile(slugOrUrl: string) {
  const slug = slugOrUrl.trim().replace(/^https?:\/\/[^/]+\/profile\//, "").split(/[/?#]/)[0];
  const d = await call("PublicProfileView", { input: { slug }, locale: LOCALE }, { "x-visitor-id": VISITOR_ID, "x-channel": "web" });
  const v = d?.publicProfileView;
  if (!v) throw new Error(`Seek has no public profile "${slug}"`);
  return clean({
    slug: v.slug,
    restricted: v.__typename === "RestrictedPublicProfileView" || undefined,
    name: [v.firstName, v.lastName].filter(Boolean).join(" "),
    location: v.homeLocation?.label,
    verifiedName: v.digitalIdentity?.verifiedName,
    verified: v.digitalIdentity?.isVerified,
    summary: v.personalSummary,
    roles: v.workHistories?.map((w: any) =>
      clean({ title: w.roleTitle, company: w.companyName, duration: w.duration?.label, achievements: w.achievements }),
    ),
    education: v.educationV2?.map((e: any) => clean({ name: e.name, institute: e.institute, completion: e.completion?.label, highlights: e.highlights })),
    licences: v.licences?.map((l: any) => clean({ name: l.name, issuer: l.issuingOrganisation, description: l.description })),
    skills: v.skills,
    languages: v.languages,
    rightsToWork: v.rightsToWork?.map((r: any) => clean({ country: r.countryLabel, status: r.statusLabel, verified: r.isVerified })),
    isYou: v.isOwnedByLoggedInUser,
    url: `${ORIGIN}/profile/${v.slug}`,
  });
}

const page = (cursor?: number, pageSize?: number) => ({ cursor: Math.max(1, cursor ?? 1), pageSize: Math.min(pageSize ?? 20, 50) });

const directoryRow = (r: any) =>
  clean({
    slug: r.slug,
    name: r.name,
    agency: r.agencyName,
    rating: r.rating != null ? Math.round(r.rating * 100) / 100 : undefined,
    reviews: r.reviewCount,
    placements: r.placementCount,
    specialisations: r.specialisations,
    location: [r.address?.city, r.address?.country].filter(Boolean).join(", ") || undefined,
  });

export async function searchRecruiters(p: {
  type?: "recruiter" | "agency"; query?: string; placementTitle?: string; specialisations?: string[]; roleTypes?: string[];
  region?: string; country?: string; reviewedInLast12Months?: boolean; page?: number; pageSize?: number;
}) {
  const filters: Array<{ name: string; values: string[] }> = [];
  if (p.reviewedInLast12Months ?? true) filters.push({ name: "LAST_REVIEW_DATE", values: ["last12Months"] });
  filters.push({ name: "COUNTRY", values: [p.country ?? DIRECTORY_COUNTRY] });
  if (p.region) {
    const f = (await publicGql("GetFiltersData"))?.sourcr?.searchFilters;
    const country = (f?.locations ?? []).find((l: any) => l.country === (p.country ?? DIRECTORY_COUNTRY));
    const hit = (country?.postcodes ?? []).find((pc: any) => pc.name.toLowerCase() === p.region!.toLowerCase());
    if (!hit) throw new Error(`Unknown region "${p.region}" (regions: ${(country?.postcodes ?? []).map((x: any) => x.name).join(", ")})`);
    filters.push({ name: "POSTCODE", values: [hit.value] });
  }
  if (p.specialisations?.length) filters.push({ name: "SPECIALISATIONS", values: p.specialisations });
  if (p.roleTypes?.length) filters.push({ name: "ROLE_TYPES", values: p.roleTypes });
  if (p.placementTitle) filters.push({ name: "PLACEMENT_TITLES", values: [p.placementTitle] });
  const agency = p.type === "agency";
  const d = await publicGql(agency ? "SearchAgency" : "SearchRecruiter", {
    input: { query: p.query ?? "", pagination: page(p.page, p.pageSize), filters, withBoost: true, visitorId: VISITOR_ID },
  });
  const r = agency ? d?.sourcr?.searchAgency : d?.sourcr?.searchRecruiter;
  return clean({
    type: agency ? "agency" : "recruiter",
    total: r?.pagination?.totalItems,
    page: r?.pagination?.cursor,
    results: (r?.items ?? []).map(directoryRow),
  });
}

export async function featuredRecruiters(type?: "recruiter" | "agency") {
  const agency = type === "agency";
  const d = await publicGql(agency ? "FeaturedAgencies" : "FeaturedRecruiters", { country: DIRECTORY_COUNTRY });
  const r = agency ? d?.sourcr?.featuredAgencies : d?.sourcr?.featuredRecruiters;
  return clean({
    type: agency ? "agency" : "recruiter",
    featured: true,
    total: r?.pagination?.totalItems,
    results: (r?.items ?? []).map(directoryRow),
  });
}

export async function recruiterFilters() {
  const f = (await publicGql("GetFiltersData"))?.sourcr?.searchFilters;
  return {
    regions: Object.fromEntries((f?.locations ?? []).map((l: any) => [l.country, (l.postcodes ?? []).map((p: any) => p.name)])),
    specialisations: f?.specialities ?? [],
    roleTypes: f?.roles ?? [],
  };
}

const directorySlug = (s: string) => s.trim().replace(/^https?:\/\/[^/]+\/recruiters\/(?:recruiter|agency)\//, "").split(/[/?#]/)[0];

export async function recruiterProfile(p: {
  slug: string; type?: "recruiter" | "agency"; section?: "profile" | "reviews" | "jobs" | "placements" | "team" | "awards"; page?: number; pageSize?: number;
}) {
  const slug = directorySlug(p.slug);
  const agency = p.type === "agency";
  const type = agency ? "AGENCY" : "RECRUITER";
  const pagination = page(p.page, p.pageSize ?? 10);
  switch (p.section ?? "profile") {
    case "profile": {
      const d = await publicGql(agency ? "SeekDirectoryAgencyProfileDetails" : "SeekDirectoryRecruiterProfileDetails", {
        slug, visitorId: VISITOR_ID, type, limit: 10,
      }, { partialOk: true });
      const s = d?.sourcr;
      const prof = agency ? s?.agencyProfileDetails : s?.recruiterProfileDetails;
      if (!prof) throw new Error(`No ${type.toLowerCase()} "${slug}" in Seek's recruiter directory`);
      return clean({
        ...directoryRow(prof),
        agency: prof.agency ? { name: prof.agency.name, slug: prof.agency.slug } : undefined,
        phone: prof.contactNumber,
        website: prof.website,
        recommended: prof.isRecommended,
        placementsTotal: prof.reviewsInsight?.placementCount,
        awards: s?.awards?.items?.map(awardRow),
        recentPlacements: s?.paginatedPlacements?.items?.map(placementRow),
        openJobs: s?.paginatedJobs?.items?.map(jobRow),
        team: s?.paginatedRecruiters?.items?.map(directoryRow),
      });
    }
    case "reviews": {
      const d = await publicGql(agency ? "GetAgencyReview" : "GetRecruiterReview", { slug, pagination }, { partialOk: true });
      const s = d?.sourcr;
      const list = agency ? s?.agencyPaginatedReviews : s?.recruiterPaginatedReviews;
      const sum = agency ? s?.agencyProfileDetails : s?.recruiterProfileDetails;
      return clean({
        rating: sum?.rating, reviews: sum?.reviewCount, inLast12Months: sum?.reviewsInsight?.last12MonthsReviewCount,
        total: list?.pagination?.totalItems,
        items: (list?.items ?? []).map((r: any) =>
          clean({
            title: r.title, review: r.review, rating: r.rating, by: r.firstName, type: r.type,
            responsiveness: r.responsiveness, communication: r.communication, industryKnowledge: r.industryKnowledge,
            recruiter: r.recruiter?.name, agency: r.agency?.name, reply: r.replyMessage, at: r.createdAt?.dateTime,
          }),
        ),
      });
    }
    case "jobs": {
      const d = await publicGql("PaginatedJobs", { slug, type, pagination });
      const r = d?.sourcr?.paginatedJobs;
      return { total: r?.pagination?.totalItems, jobs: (r?.items ?? []).map(jobRow) };
    }
    case "placements": {
      const d = await publicGql("PaginatedPlacements", { slug, type, pagination });
      const r = d?.sourcr?.paginatedPlacements;
      return { total: r?.pagination?.totalItems, placements: (r?.items ?? []).map(placementRow) };
    }
    case "team": {
      const d = await publicGql("GetTeamData", { slug, pagination });
      const r = d?.sourcr?.paginatedRecruiters;
      return { total: r?.pagination?.totalItems, recruiters: (r?.items ?? []).map(directoryRow) };
    }
    case "awards": {
      const d = await publicGql("GetSourcrAwards", { slug, type, limit: Math.min(p.pageSize ?? 20, 50) });
      const r = d?.sourcr?.awards;
      return { total: r?.totalItems ?? 0, awards: (r?.items ?? []).map(awardRow) };
    }
  }
}

const placementRow = (pl: any) =>
  clean({ title: pl.jobTitle, type: pl.jobType, salary: pl.salaryRange, category: pl.category?.name, location: [pl.address?.city, pl.address?.state].filter(Boolean).join(", ") || undefined });
const jobRow = (j: any) =>
  clean({ id: j.jobId ?? j.id, title: j.title, location: j.location, posted: j.createdAt?.dateTime, url: j.url });
const AWARD_SOURCES: Record<string, string> = { sara: "SEEK Annual Recruitment Awards", sourcr: "Recognition In Service Excellence" };
const awardRow = (a: any) => clean({ name: a.name, years: a.years, result: a.result, source: AWARD_SOURCES[a.source] ?? a.source });



export async function contactRecruiter(p: {
  slug: string; type?: "recruiter" | "agency"; name: string; email: string; message: string; phone?: string; jobId?: string;
}) {
  if (!p.message.trim()) throw new Error("The message is empty");
  const send = (vars: Record<string, unknown>) => (isSignedIn() ? sgql("ContactRecruiterByEmail", vars) : publicGql("ContactRecruiterByEmail", vars));
  const d = await send({
    input: {
      message: p.message.trim(),
      slug: directorySlug(p.slug),
      type: p.type === "agency" ? "AGENCY" : "RECRUITER",
      name: p.name,
      email: p.email,
      ...(p.phone ? { number: p.phone } : {}),
      country: COUNTRY,
      ...(p.jobId ? { jobId: p.jobId } : {}),
    },
  });
  const r = d?.contactRecruiterByEmail;
  const err = r?.errors?.[0];
  if (err || r?.__typename === "ContactRecruiterFailure") throw new Error(`Seek did not send the message: ${err?.message ?? err?.code ?? "rejected"}`);
  return { sent: true, to: p.slug, confirmation: r?.message ?? null };
}

async function contactLimits() {
  const d = await sgql("GetContactCapabilities");
  return (d?.sourcr?.contactCapabilities?.capabilities ?? []).map((c: any) =>
    clean({ type: c.type, enabled: c.enabled, used: c.activeCount, max: c.maxActive, windowHours: c.ttlHours, reason: c.reasonCode }),
  ) as Array<{ type?: string; enabled?: boolean; used?: number; max?: number; windowHours?: number; reason?: string }>;
}

export async function callRecruiter(p: { slug: string; type?: "recruiter" | "agency" }) {
  if (!isSignedIn()) throw new NotLoggedInError("Seek shows a recruiter's number for a call only to signed-in users, and records the call against the account");
  const slug = directorySlug(p.slug);
  const agency = p.type === "agency";
  const d = await publicGql(agency ? "SeekDirectoryAgencyProfileDetails" : "SeekDirectoryRecruiterProfileDetails", {
    slug, visitorId: VISITOR_ID, type: agency ? "AGENCY" : "RECRUITER", limit: 1,
  }, { partialOk: true });
  const prof = agency ? d?.sourcr?.agencyProfileDetails : d?.sourcr?.recruiterProfileDetails;
  if (!prof) throw new Error(`No ${agency ? "agency" : "recruiter"} "${slug}" in Seek's recruiter directory`);
  if (!prof.contactNumber) throw new Error(`${prof.name ?? slug} has no phone number in Seek's directory; use method "email"`);
  const limits = await contactLimits();
  const capped = limits.filter((c) => !c.enabled);
  if (!limits.length || capped.length) {
    const detail = capped.map((c) => `${c.type}: ${c.used ?? "?"} of ${c.max ?? "?"} in ${c.windowHours ?? "?"}h${c.reason ? ` (${c.reason})` : ""}`).join("; ");
    throw new Error(`Seek's recruiter-contact limit stops this call${detail ? `: ${detail}` : " (no contact allowance on the account)"}`);
  }
  const r = await sgql("ContactRecruiterByCall");
  return clean({
    slug,
    name: prof.name,
    phone: prof.contactNumber,
    recorded: true,
    message: r?.contactRecruiterByCall?.message,
    note: "Seek recorded the call against this account's recruiter-contact limit; nobody was called. Ring the number yourself.",
    limits: await contactLimits().catch(() => undefined),
  });
}
