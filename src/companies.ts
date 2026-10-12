import { isSignedIn, sgql } from "./auth.js";
import { search } from "./api.js";
import { COUNTRY, LOCALE, ORIGIN, ZONE, clean, htmlToText, publicGql } from "./seek.js";

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
    industryId: o.industryId,
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

const paragraphs = (x: unknown) =>
  Array.isArray(x) ? x.map((s) => String(s ?? "").trim()).filter(Boolean).join("\n\n") || undefined : undefined;

export async function companyGraduates(ref: string, pageSize = 20) {
  const id = await resolveCompanyId(ref);
  const d = await publicGql("GetGraduatesTabData", {
    brand: "seek",
    channel: "web",
    companyDetailsId: id,
    country: COUNTRY,
    draft: false,
    locale: LOCALE,
    pageSize,
  }, { partialOk: true });
  const p = d?.companyDetails?.companyProfile;
  if (!p?.data) throw new Error(`Seek has no published profile for company ${id}`);
  const g = p.data.graduates;
  const overview = paragraphs(g?.overview?.richTextBody);
  if (!overview) return { companyId: id, company: p.data.name ?? null, graduates: false, note: "This company's Seek profile has no Graduates tab" };
  const results = g.jobs?.results;
  return clean({
    companyId: id,
    company: p.data.name,
    organisationId: p.organisationId,
    overview,
    website: g.overview?.externalUrl,
    programs: (g.programs ?? []).filter(Boolean).map((x: any) =>
      clean({
        title: x.title,
        slug: x.slug,
        summary: x.summary,
        eligibility: x.programEligibility,
        workRights: x.workRights,
        applicationsOpen: x.programApplicationsOpen,
        startDate: x.startDate,
        details: paragraphs(x.body),
      }),
    ),
    applicationSteps: (g.applicationProcessSteps ?? []).filter(Boolean).map((s: any) => clean({ title: s.title, description: paragraphs(s.description) })),
    stories: (g.stories ?? []).filter(Boolean).map((s: any) => clean({ name: s.name, slug: s.slug, summary: s.summary, story: paragraphs(s.body) })),
    videos: g.videos,
    totalJobs: results?.pagination?.resultCount,
    jobs: (results?.jobs ?? []).filter((j: any) => j?.id).map((j: any) =>
      clean({
        id: j.id,
        title: j.title,
        advertiser: j.advertiser?.name,
        location: j.location?.displayName?.text,
        classification: j.categories?.filter(Boolean)?.[0]?.label,
        subclassification: j.categories?.filter(Boolean)?.[1]?.label,
        listed: j.listedAt?.dateTimeUtc ?? j.createdAt?.dateTimeUtc,
        listedAgo: j.listedAt?.shortLabel,
        abstract: j.abstract,
        bullets: j.cjs?.product?.bullets,
        url: j.url ? (String(j.url).startsWith("/") ? `${ORIGIN}${j.url}` : j.url) : `${ORIGIN}/job/${j.id}`,
      }),
    ),
  });
}

const INDUSTRIES: Record<string, string> = {
  I0000: "Accounting & Auditing", I0001: "Advertising, Marketing & Communications Services", I0002: "Agriculture, Forestry & Fishing",
  I0003: "Airlines/Aviation", I0004: "Architectural & Design Services", I0005: "Armed Forces", I0006: "Arts & Cultural Services",
  I0007: "Automotive", I0008: "Banking & Credit", I0009: "Broadcast Media, Entertainment and Publishing", I0010: "Building Supplies",
  I0011: "Casinos & Gambling", I0012: "Chemicals & Plastics Manufacturing", I0013: "Commercial & Industrial Property Management",
  I0014: "Computer Software & Networking", I0015: "Construction", I0016: "Construction, Design & Engineering",
  I0017: "Consumer Electronics Manufacturing", I0018: "Personal, Home & Vehicle Services", I0019: "Corrective & Security Services",
  I0020: "Defence, Aerospace & Marine", I0021: "Drinks Retail", I0022: "Education, Training & Professional Development",
  I0023: "Education, Training & Research", I0024: "Electricity, Gas & Water Services", I0025: "Employment Services",
  I0026: "Employment, Outsourcing & Facilities", I0027: "Engineering & Project Management Services",
  I0028: "Environmental Services & Waste Management", I0029: "Equipment Management & Hire", I0030: "FMCG Manufacturing",
  I0031: "Facilities Management & Outsourced Services", I0032: "Fashion Retail & Department Stores", I0033: "Fast Food/Takeaway Outlets",
  I0034: "Film, Music & Program Production", I0035: "Financial & Insurance Services", I0036: "Financial Investment Services",
  I0037: "Sports & Fitness", I0038: "Food, Hospitality & Tourism", I0039: "Government Administration & Politics",
  I0040: "Government, Defence & Public Safety", I0041: "Hair & Beauty Services", I0042: "Healthcare & Social Assistance",
  I0043: "Healthcare Services", I0044: "Home & Garden Retail", I0045: "Home & Garden Services", I0046: "Hotel & Accommodation Services",
  I0047: "Household Goods & Appliances Manufacturing", I0048: "Machinery & Automation", I0049: "Information & Communication Technology (ICT)",
  I0050: "Information Technology Services", I0051: "Insurance", I0052: "Law Enforcement & Emergency Services", I0053: "Legal Services",
  I0054: "Logistics, Freight & Delivery Services", I0055: "Luxury & Designer Goods Retail", I0056: "Consulting Services",
  I0057: "Manufacturing", I0058: "Media, Advertising & Online", I0059: "Mining, Minerals & Metals", I0060: "Non-Profit Organisations",
  I0061: "Oil & Gas Extraction & Refinement", I0062: "Online Media & eCommerce", I0063: "Optical Retail",
  I0064: "Packaging, Paper & Forest Products", I0065: "Passenger Transportation (Ground/Water)",
  I0066: "Pharmaceuticals, Biotechnology & Medical Devices", I0067: "Health & Beauty Retail", I0068: "Primary Industries & Metals",
  I0069: "Professional Services", I0070: "Pubs, Bars & Clubs", I0071: "Real Estate & Property Services", I0072: "Residential Real Estate",
  I0073: "Restaurants & Cafes (Full Service)", I0074: "Retail & Wholesale", I0075: "Science & Research", I0076: "Social & Welfare Services",
  I0077: "Specialty Retail", I0078: "Supermarkets, Grocery & Petrol Retailing", I0079: "Telecommunications & Internet Service Providers",
  I0080: "Textiles, Clothing & Accessories", I0081: "Recreation & Entertainment Venues", I0082: "Transport & Logistics",
  I0083: "Travel Agents, Tour Operators & Tourist Services", I0084: "Electricity, Gas, Water & Waste Services",
  I0085: "Vehicle Rental & Removalists", I0086: "Vehicle Services & Repair", I0087: "Wholesale Businesses",
  I0088: "Business Support Services", I0089: "Direct Selling",
};

export const industryList = () => Object.entries(INDUSTRIES).map(([id, name]) => ({ id, name }));

function industryId(industry: string): string {
  const q = industry.trim();
  if (/^i\d{4}$/i.test(q)) return q.toUpperCase();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const entries = Object.entries(INDUSTRIES);
  const exact = entries.find(([, name]) => norm(name) === norm(q));
  if (exact) return exact[0];
  const partial = entries.filter(([, name]) => norm(name).includes(norm(q)));
  if (partial.length === 1) return partial[0][0];
  if (partial.length > 1) throw new Error(`"${industry}" matches several industries: ${partial.map(([id, n]) => `${n} (${id})`).join(", ")}`);
  throw new Error(`Seek has no industry "${industry}"; seek_company_search with industries: true lists them`);
}

export async function companiesByIndustry(industry: string, limit = 20) {
  const id = industryId(industry);
  const d = await publicGql("GroupedCompanies", {
    groupBy: { group: "INDUSTRY", value: [id] },
    perPage: limit,
    randomSeed: new Date().toISOString().slice(0, 10),
    zone: ZONE,
    excludedCompanyIds: [],
  });
  const g = (d?.groupedCompanies ?? []).find((x: any) => x?.groupName);
  if (!g) throw new Error(`Seek returned no companies for industry ${id}; seek_company_search with industries: true lists the industries`);
  return {
    industry: { id, name: g.groupName },
    companies: (g.companies ?? []).map((c: any) =>
      clean({ id: c.id, name: c.name, slug: c.slug, url: c.slug ? `${ORIGIN}/companies/${c.slug}` : undefined }),
    ),
  };
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
