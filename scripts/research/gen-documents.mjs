import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const catalog = JSON.parse(readFileSync(process.argv[2] ?? `${root}.research/catalog.json`, "utf8"));

const OPS = [
  "getKeywordSuggestions", "searchLocationsSuggest", "getClassificationOptions", "getProfileLocationSuggest",
  "getEducationProviders", "getQualifications", "getOrganisations", "getRoleTitle", "getSpecReqs",
  "getRightToWorkOptions", "GetRightToWorkOptions", "GetAvailabilityOptions", "GetWorkTypeOptions",
  "GetProfileVisibilityOptions", "GetSupportedCountries",
  "jobDetails", "jobDetailsPersonalised", "JobDetailsRecommendedJobs", "getJobDetailsBadges", "GetMatchedQualities",
  "JobDetailsSalaryMatch", "CandidateJobMatch", "CandidateJobMatchAllocation", "createCandidateJobMatchRequest",
  "CreateReportedJob", "GetSimilarCommonJobs",
  "GetRecommendedJobs", "CandidateJobPreferences", "SaveJobPreference", "DeleteJobPreferences",
  "GetSavedSearches", "CreateApacSavedSearch", "DeleteApacSavedSearch", "UpdateSavedSearchEmailAlert",
  "GetAppliedJobDetail", "SetSavedJobNotes", "RemoveSavedJobNotes", "SetAppliedJobNotes", "RemoveAppliedJobNotes",
  "DeleteAppliedJob", "MarkAsPreferredApplication", "GetResumeLink", "GetCoverLetterLink", "GetPriorityApplyCredit",
  "GetCareerObjectives", "UpdateCareerObjectives", "GetConfirmedRoles", "GetUnconfirmedRoles", "ConfirmRole",
  "RejectRole", "DeleteRole", "GetConfirmedQualifications", "GetUnconfirmedQualifications", "UpdateQualification",
  "ConfirmQualification", "RejectQualification", "DeleteQualification", "GetLicences", "UpdateLicence", "DeleteLicence",
  "GetSkills", "GetSuggestedSkills", "UpdateSkills", "GetLanguageProficiencies", "UpdateLanguageProficiency",
  "DeleteLanguageProficiency", "GetAvailability", "UpdateAvailability", "GetWorkTypes", "UpdatePreferredWorkTypes",
  "GetPreferredLocations2", "UpdatePreferredLocations2", "GetPreferredClassification", "UpdatePreferredClassification",
  "GetPreferredRoleTitleList", "UpdatePreferredRoleTitleList", "GetSalaryPreferences", "UpdateSalaryPreferences",
  "GetRightsToWork", "UpdateRightsToWork", "GetApproachability", "UpdateApproachability", "GetProfileVisibility2",
  "UpdateProfileVisibility2", "GetProfileAvatar", "CreateProfileAvatar", "GetProfileAvatarStatus", "DeleteProfileAvatar",
  "GetProfileInsights", "GetScore", "getVerifications", "getReferenceChecks", "GetPublicProfile", "GetPersonalDetails",
  "DocumentDownloadLink", "GenerateResumeFromProfile", "GetResumeById",
  "GetCTPPreference", "updateNotificationCtpPreferences", "changeEmailStart", "changeEmailVerify", "deleteAccount",
  "ApplyProcessUploadedAttachment", "createApplyLinkout",
  "SearchCompanies", "GetCompanyDetailAndReviewSummary", "CompanyReviews", "CompanyReviewLocations",
  "GetCompanySalaryRange", "CompanyNameSlug", "PostCompanyProfileReviewUpvotes", "PostCompanyProfileReviewFlag",
  "PublicProfileSearch", "PublicProfileView", "GetSuggestionsForLocation",
  "SearchRecruiter", "SearchAgency", "SeekDirectoryRecruiterProfileDetails", "SeekDirectoryAgencyProfileDetails",
  "GetRecruiterReview", "GetAgencyReview", "PaginatedJobs", "PaginatedPlacements", "GetTeamData", "GetFiltersData",
  "ContactRecruiterByEmail", "GetContactCapabilities",
  "AutoSuggestV2", "SearchV2", "SearchV2Articles", "GetRole", "GetRoleTasksAndDuties", "GetRoleWhatsItLike",
  "GetHowToBecome", "GetRoleSpecReqs", "GetSimilarRoles", "GetRoleReviewStats", "GetRoleReviews", "GetWorkHours",
  "GetRoleGrowth", "GetRoleClassifications", "GetSalarySuggestionByRoleAndLocation", "GetRoleClassSalariesById",
  "GetArticleV2", "GetLatestArticles", "GetArticlesByCategoryId", "GetCategoryByAlias", "Classifications",
  "GetRolesByClassificationUrl",
];

const missing = OPS.filter((n) => !catalog[n]);
if (missing.length) throw new Error(`not in the catalogue: ${missing.join(", ")}`);
const incomplete = OPS.filter((n) => catalog[n].missingFragments);
if (incomplete.length) throw new Error(`fragments missing for: ${incomplete.map((n) => `${n} (${catalog[n].missingFragments})`).join(", ")}`);

const lines = [
  "export const D = {",
  ...OPS.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(catalog[n].text)},`),
  "} as const;",
  "",
  "export type DocumentName = keyof typeof D;",
  "",
];
writeFileSync(`${root}src/documents.ts`, lines.join("\n"));
console.log(`wrote ${OPS.length} documents to src/documents.ts`);
