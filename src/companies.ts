import { isSignedIn, sgql } from "./auth.js";
import { search } from "./api.js";
import { LOCALE, ORIGIN, ZONE, clean, htmlToText, publicGql } from "./seek.js";

export async function resolveCompanyId(ref: string): Promise<string> {
  const s = ref.trim().replace(/^https?:\/\/[^/]+\/companies\//, "").split(/[/?#]/)[0];
  const tail = /(\d{9,})$/.exec(s)?.[1];
  if (tail) return tail;
  const hits = await searchCompanies(s, 1);
  if (!hits.length) throw new Error(`Seek has no company profile matching "${ref}"`);
  return hits[0].id;
}

export async function searchCompanies(name: string, limit = 10) {
  const d = await publicGql("SearchCompanies", { name, includeBranding: false, limit, zone: ZONE, published: true });
  return (d?.searchCompanyProfilesByName ?? []).map((c: any) =>
    clean({
      id: c.companyId,
      name: c.data?.name,
      slug: c.data?.slug,
      rating: c.data?.reviewRating,
      reviews: c.data?.reviewCount,
      url: c.data?.slug ? `${ORIGIN}/companies/${c.data.slug}` : undefined,
    }),
  );
}

const rating = (r: any) => (r ? clean({ rating: r.rating, percent: r.percentage, count: r.count }) : undefined);

export async function company(ref: string) {
  const id = await resolveCompanyId(ref);
  const d = (await publicGql("GetCompanyDetailAndReviewSummary", { companyDetailsId: id, locale: LOCALE }, { partialOk: true }))
    ?.companyDetails;
  const p = d?.companyProfile;
  if (!p?.data) throw new Error(`Seek has no published profile for company ${id}`);
  const r = p.companyReviewRating;
  const o = p.data.overview ?? {};
  return clean({
    id,
    name: p.data.name,
    claimed: p.data.isClaimed,
    industry: o.industryName ?? o.industry,
    size: o.size,
    primaryLocation: o.primaryLocation,
    website: o.website?.url,
    specialities: o.specialities,
    description: (o.description ?? []).join("\n\n"),
    missionStatement: p.data.missionStatement,
    customStatement: p.data.customStatement,
    featured: p.data.featured,
    awards: p.data.awards,
    cultureAndValues: p.data.cultureAndValues,
    perksAndBenefits: p.data.perksAndBenefits,
    ratings: r
      ? {
          overall: rating(r.company),
          recommended: rating(r.companyRecommended),
          perksAndBenefits: rating(r.perksAndBenefits),
          careerOpportunity: rating(r.careerOpportunity),
          diversity: rating(r.diversity),
          management: rating(r.executiveManagement),
          workLifeBalance: rating(r.workLifeBalance),
          workEnvironment: rating(r.workEnvironment),
          stars: [1, 2, 3, 4, 5].map((n) => ({ stars: n, ...rating(r[`companyRating${n}Star`]) })),
          salary: { poor: rating(r.salaryPoor), fair: rating(r.salaryFair), generous: rating(r.salaryGenerous) },
        }
      : undefined,
    reviewSummary: d.companyReviewsAISummary?.aISummaryContent?.positiveAndChallengesSummary
      ? {
          text: htmlToText(d.companyReviewsAISummary.aISummaryContent.positiveAndChallengesSummary),
          reviews: d.companyReviewsAISummary.reviewsCount,
          from: d.companyReviewsAISummary.reviewsDateFrom,
          to: d.companyReviewsAISummary.reviewsDateTo,
        }
      : undefined,
    organisationId: p.organisationId,
    url: p.data.canonicalUrl ?? `${ORIGIN}/companies/${id}`,
  });
}

export async function companyJobs(ref: string, page = 1, pageSize = 20) {
  const id = await resolveCompanyId(ref);
  const d = (await publicGql("GetCompanyDetailAndReviewSummary", { companyDetailsId: id, locale: LOCALE }, { partialOk: true }))
    ?.companyDetails?.companyProfile;
  const organisationId = d?.organisationId;
  if (!organisationId) throw new Error(`Company ${id} has no organisation id on Seek, so its jobs cannot be listed`);
  return { companyId: id, company: d?.data?.name ?? null, organisationId, ...(await search({ companyId: String(organisationId), page, pageSize, sort: "newest" })) };
}

async function whereId(place: string): Promise<number> {
  const s: any = await search({ where: place, pageSize: 1 });
  const id = Number(s?.where?.whereId);
  if (!id) throw new Error(`Seek did not recognise the location "${place}"`);
  return id;
}

export async function companyReviews(p: { company: string; page?: number; perPage?: number; sort?: "recent" | "helpful"; location?: string }) {
  const id = await resolveCompanyId(p.company);
  const locationId = p.location ? await whereId(p.location) : undefined;
  const d = await publicGql("CompanyReviews", {
    companyProfileId: id,
    newCompanyProfileId: id,
    zone: ZONE,
    locale: LOCALE,
    page: p.page ?? 1,
    perPage: Math.min(p.perPage ?? 10, 30),
    sort: p.sort === "helpful" ? "-upvote_count" : "",
    ...(locationId ? { locationId } : {}),
  }, { partialOk: true });
  const reviews = d?.companyDetails?.companyReviews;
  return clean({
    companyId: id,
    overallRating: d?.companyProfile?.reviewsSummary?.overallRating?.value,
    totalReviews: d?.companyProfile?.reviewsSummary?.overallRating?.numberOfReviews?.value,
    paging: reviews?.paging,
    reviews: (reviews?.data ?? []).map((r: any) =>
      clean({
        id: r.id,
        title: r.title,
        rating: r.overallRating,
        jobTitle: r.jobTitle,
        location: r.workLocation,
        employment: r.employmentStatus,
        salary: r.salarySummary,
        recommended: r.recommended?.value,
        pros: r.pros,
        cons: r.cons,
        details: r.overallExperienceDetails,
        ratings: Object.fromEntries((r.ratings ?? []).map((x: any) => [x.description, x.value])),
        helpful: r.upvotes?.count,
        posted: r.createdAt?.shortAbsoluteLabel,
        employerReply: r.reply ? { from: r.reply.from, text: r.reply.text, at: r.reply.createdAt?.dateTime } : undefined,
      }),
    ),
  });
}

export async function companyReviewLocations(ref: string) {
  const id = await resolveCompanyId(ref);
  const d = await publicGql("CompanyReviewLocations", { companyDetailsId: id, locale: LOCALE, zone: ZONE, sort: true });
  return (d?.companyDetails?.companyReviewLocations ?? []).map((l: any) => l.contextualName);
}

export async function companySalaries(ref: string) {
  const id = await resolveCompanyId(ref);
  const d = await publicGql("GetCompanySalaryRange", { companyDetailsId: id, locale: LOCALE });
  const s = d?.companyDetails?.companySalaryRange;
  return clean({
    companyId: id,
    updated: s?.lastUpdatedAt?.shortAbsoluteLabel,
    roles: (s?.salaryRangeByRoles ?? []).map((r: any) =>
      clean({
        role: r.roleTitle,
        roleId: r.roleId,
        atCompany: r.salaryRangeByCompany ? { range: r.salaryRangeByCompany.label, type: r.salaryRangeByCompany.salaryType, jobs: r.salaryRangeByCompany.jobsCount } : undefined,
        industry: r.salaryRangeByIndustry
          ? { range: r.salaryRangeByIndustry.label, type: r.salaryRangeByIndustry.salaryType, jobs: r.salaryRangeByIndustry.jobsCount, note: r.salaryRangeByIndustry.industryAverageDescription }
          : undefined,
      }),
    ),
  });
}

export const REVIEW_FLAG_REASONS = [
  "spam", "disagree", "personal_info", "offensive", "sensitive", "response_inappropriate", "bias", "others",
] as const;

export async function voteOrFlagReview(p: {
  company: string; reviewId: string; action: "helpful" | "flag"; reason?: (typeof REVIEW_FLAG_REASONS)[number]; details?: string;
}) {
  if (!isSignedIn()) throw new Error("Voting on or reporting a review needs seek_auth");
  const companyId = await resolveCompanyId(p.company);
  if (p.action === "helpful") {
    const d = await sgql("PostCompanyProfileReviewUpvotes", { input: { companyId, reviewId: p.reviewId } });
    return { reviewId: p.reviewId, markedHelpful: !!d?.postCompanyProfileReviewUpvotes?.success };
  }
  if (!p.reason) throw new Error(`Say why the review is being reported (reason: ${REVIEW_FLAG_REASONS.join(" | ")})`);
  if (!p.details?.trim()) throw new Error("Seek asks what the issue with the review is: pass details");
  const d = await sgql("PostCompanyProfileReviewFlag", {
    input: { companyId, reviewId: p.reviewId, reason: p.reason, details: p.details.trim() },
  });
  return { reviewId: p.reviewId, reported: !!d?.postCompanyProfileReviewFlag?.success };
}
