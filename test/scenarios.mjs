import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const files = mkdtempSync(join(tmpdir(), "seek-scenario-files-"));
export const PDF = join(files, "letter.pdf");
export const PNG = join(files, "photo.png");
writeFileSync(PDF, "%PDF-1.4 test");
writeFileSync(PNG, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

export const ROLE_ID = "11111111-1111-4111-8111-111111111111";
export const RESUME_ID = "22222222-2222-4222-8222-222222222222";
export const EMAIL = "candidate@example.com";

export const CANNED = {
  GetUserDetails: { viewer: { _id: "1", emailAddress: EMAIL } },
  GetResumes: { viewer: { _id: "1", resumes: [{ id: RESUME_ID, isDefault: true }] } },
  CurrentLocation: { viewer: { _id: "1", currentLocation2: { id: "30182" } } },
  GetUnconfirmedRoles: {
    viewer: {
      _id: "1",
      unconfirmedRoles: [{ id: ROLE_ID, title: { text: "Accountant", ontologyId: null }, company: { text: "Acme", ontologyId: null }, from: { year: 2020, month: 1 }, to: { year: 2023, month: 6 } }],
    },
  },
  GetUnconfirmedQualifications: {
    viewer: { _id: "1", unconfirmedQualifications: [{ id: ROLE_ID, name: { text: "BCom" }, institute: { text: "University of Auckland" }, completed: true, completionDate: { year: 2019 } }] },
  },
  GetSalaryPreferences: { viewer: { _id: "1", salaryPreferences2: [] } },
  GetRightsToWork: { viewer: { _id: "1", rightsToWork: [] } },
  GetSkills: { viewer: { _id: "1", skills2: [{ keyword: { text: "Excel", ontologyId: null } }] } },
  CreateProfileAvatar: { createProfileAvatar: { __typename: "CreateProfileAvatarSuccess", avatarId: "av1", uploadUrl: "https://upload.example.test/avatar" } },
  GetProfileAvatarStatus: { viewer: { _id: "1", profileAvatarStatus: { __typename: "ProfileAvatarStatusSuccess" } } },
  GetAppliedJobs: {
    viewer: { id: "1", appliedJobs: { edges: [{ node: { id: "a1", applicationRequestId: "req-1", job: { id: "95000001", title: "Accountant", advertiser: { name: "Acme" } }, events: [] } }] } },
  },
  GetPriorityApplyCredit: { priorityApplyCredit: { credit2: { __typename: "PendingCredit", remainingCount: 2, totalCredit: 3 } } },
  GetAppliedJobDetail: { viewer: { id: "1", appliedJob: { id: "a1", documents: { resume: { attachmentMetadata: { fileName: "cv.pdf" } } } } }, jobDetails: { insights: [] } },
  GetDocumentUploadData: {
    viewer: { documentUploadFormData: { link: "https://upload.example.test/s3", key: "k", formFields: [{ key: "key", value: "k" }] } },
  },
  ApplyProcessUploadedAttachment: { processUploadedAttachment: { uri: "/v2/blobstore/attachments/x/" } },
  ApplyProcessUploadedResume: {
    processUploadedResume: { resume: { id: RESUME_ID, fileMetadata: { uri: "/v2/blobstore/resumes/x/", virusScanStatus: "OK" } }, viewer: { _id: "1", resumes: [] } },
  },
  WrittenSelectionCriteria: { generateSelectionCriteria: { uri: "/v2/blobstore/selectioncriteria/x/" } },
  ApplySubmitApplication: { submitApplication: { applicationId: "app-1" } },
  TrackJobApplicationStarted: { trackJobApplicationStarted: { eventId: "e" } },
  WrittenCoverLetter: { generateCoverLetter: { uri: "/v2/blobstore/coverletters/x/" } },
  createApplyLinkout: { createLinkoutApplication: { applicationUrl: "https://employer.example.test/apply" } },
  CreateReportedJob: { reportJob: { success: true } },
  ContactRecruiterByEmail: { contactRecruiterByEmail: { __typename: "ContactRecruiterSuccess", message: "sent" } },
  PostCompanyProfileReviewUpvotes: { postCompanyProfileReviewUpvotes: { success: true } },
  PostCompanyProfileReviewFlag: { postCompanyProfileReviewFlag: { success: true } },
  deleteAccount: { deleteAccount: { __typename: "DeleteAccountSuccess", ref: "r" } },
  changeEmailStart: { changeEmailStart: { ref: "r" } },
  changeEmailVerify: { changeEmailVerify: { ref: "r" } },
};

export const ANONYMOUS_CAPABLE = new Set([
  "CreateReportedJob", "ContactRecruiterByEmail", "PostProfileReport", "PostCompanyProfileReviewFlag",
  "PostCompanyProfileReviewUpvotes", "Mutation", "SubscribeToEmail", "SubscribeToAdviceAndTipsHome",
  "CreateUnregisteredApacSavedSearchWithChecksum", "UnsubscribeApacSavedSearchByCode", "updateNotificationCtpSubscriptionWithToken",
]);

export const SCENARIOS = [
  ["profile", (m) => m.api.profile()],
  ["profile sections (all)", (m) => m.sections.profileSections(["all"])],
  ["saved jobs", (m) => m.api.savedJobs()],
  ["applied jobs", (m) => m.api.appliedJobs()],
  ["apply requirements", (m) => m.api.applicationProcess("95000001")],
  ["job details signed in", (m) => m.jobs.jobDetails("95000001")],
  ["job insights", (m) => m.jobs.jobInsights("95000001")],
  ["job match request", (m) => m.jobs.requestJobMatch("95000001")],
  ["report job", (m) => m.jobs.reportJob({ id: "95000001", reason: "Misleading", comment: "test", email: EMAIL })],
  ["recommended jobs", (m) => m.activity.recommendedJobs()],
  ["job preferences", (m) => m.activity.jobPreferences()],
  ["hide / unhide job preference", (m) => m.activity.updateJobPreferences({ hide: [{ reason: "COMPANY", typeId: "123" }], unhide: ["p1"] })],
  ["saved searches", (m) => m.activity.savedSearches()],
  ["create saved search", (m) => m.activity.createSavedSearch({ keywords: "accountant", where: "All Auckland", workType: ["full_time"], workArrangement: ["hybrid"] })],
  ["delete saved search", (m) => m.activity.deleteSavedSearch("s1")],
  ["saved search alerts", (m) => m.activity.setSavedSearchAlerts("s1", false)],
  ["saved job note", (m) => m.activity.setJobNote({ id: "95000001", list: "saved", note: "call Friday" })],
  ["clear saved job note", (m) => m.activity.setJobNote({ id: "95000001", list: "saved", note: null })],
  ["applied job note", (m) => m.activity.setJobNote({ id: "95000001", list: "applied", note: "interview" })],
  ["clear applied job note", (m) => m.activity.setJobNote({ id: "95000001", list: "applied", note: null })],
  ["application detail", (m) => m.activity.applicationDetail("95000001")],
  ["remove applied job", (m) => m.activity.removeAppliedJob("95000001")],
  ["priority credits", (m) => m.activity.priorityApplyCredit()],
  ["prioritise application", (m) => m.activity.markPreferredApplication("95000001")],
  ["summary", (m) => m.sections.setSummary("Accountant with five years' experience.")],
  ["delete role", (m) => m.sections.deleteRole(ROLE_ID)],
  ["confirm suggested role", (m) => m.sections.reviewSuggestedRole(ROLE_ID, true)],
  ["reject suggested role", (m) => m.sections.reviewSuggestedRole(ROLE_ID, false)],
  ["add role", (m) => m.apply.upsertRole({ title: "Accountant", company: "Acme", from: { year: 2020, month: 1 }, to: null })],
  ["add qualification", (m) => m.sections.upsertQualification({ name: "Bachelor of Commerce", institute: "University of Auckland", completed: true, completionYear: 2019 })],
  ["add qualification in progress", (m) => m.sections.upsertQualification({ name: "MBA", institute: "AUT", completed: false, expectedCompletion: { year: 2027, month: 11 } })],
  ["delete qualification", (m) => m.sections.deleteQualification(ROLE_ID)],
  ["confirm suggested qualification", (m) => m.sections.reviewSuggestedQualification(ROLE_ID, true)],
  ["reject suggested qualification", (m) => m.sections.reviewSuggestedQualification(ROLE_ID, false)],
  ["add licence", (m) => m.sections.upsertLicence({ name: "Forklift Licence", issueDate: { year: 2021, month: 3 } })],
  ["delete licence", (m) => m.sections.deleteLicence(ROLE_ID)],
  ["add / remove skills", (m) => m.sections.updateSkills({ add: [{ text: "Xero", ontologyId: null }], remove: ["Excel"] })],
  ["add language", (m) => m.sections.addLanguage("Māori")],
  ["delete language", (m) => m.sections.deleteLanguage(ROLE_ID)],
  ["preferences (all)", (m) => m.sections.updatePreferences({
    availabilityId: 2, workTypeIds: [1, 2], preferredLocationIds: [30182], classification: { id: 1200, subclassificationId: 6140 },
    addRoleTitles: [{ text: "Accountant", ontologyId: "http://graph.seek.com/role-title/accountant" }], removeRoleTitles: ["Clerk"],
    salary: { amount: 90000, type: "Annual" }, rightsToWork: [{ countryCode: "NZ", optionId: "http://graph.seek.com/RighttoWork/11e03467-19f4-48f2-8f51-6f13ef9c7c11" }],
    approachable: true, visibility: "Standard",
  })],
  ["generate résumé", (m) => m.sections.generateResume()],
  ["résumé download link", (m) => m.sections.resumeDownloadLink(RESUME_ID)],
  ["delete avatar", (m) => m.sections.deleteAvatar()],
  ["personal details keeping location", (m) => m.apply.updatePersonalDetails({ firstName: "A", lastName: "B", phoneNumber: "211234567" })],
  ["notifications", (m) => m.settings.notificationSettings()],
  ["update notifications", (m) => m.settings.updateNotifications([{ id: "SavedSearch", channel: "email", subscribe: true, frequency: "daily" }, { id: "MarketingNewsletter", channel: "email", subscribe: false }])],
  ["change email start", (m) => m.settings.changeEmailStart("new@example.com")],
  ["change email verify", (m) => m.settings.changeEmailVerify("new@example.com", "123456")],
  ["delete account (confirmed)", (m) => m.settings.deleteAccount(EMAIL)],
  ["external application", (m) => m.apply.startExternalApplication("95000001")],
  ["prepare with written letter", (m) => m.apply.prepareApplication({ jobId: "95000001", resumeId: RESUME_ID, coverLetterText: "Dear hiring manager" })],
  ["review helpful", (m) => m.companies.voteOrFlagReview({ company: "171714227249285", reviewId: "r1", action: "helpful" })],
  ["review flag", (m) => m.companies.voteOrFlagReview({ company: "171714227249285", reviewId: "r1", action: "flag", reason: "spam", details: "advert" })],
  ["contact recruiter", (m) => m.directory.contactRecruiter({ slug: "someone", name: "A B", email: EMAIL, message: "Hello", phone: "0211234567" })],
  ["upload résumé", (m) => m.apply.uploadResume(PDF, { makeDefault: false })],
  ["upload avatar", (m) => m.sections.uploadAvatar(PNG)],
  ["prepare with uploaded documents", (m) => m.apply.prepareApplication({ jobId: "95000001", resumeId: RESUME_ID, coverLetterPath: PDF, selectionCriteriaPath: PDF })],
  ["submit application", (m) => m.apply.submitApplication({
    jobId: "95000001", resumeId: RESUME_ID, coverLetterText: "Dear hiring manager", selectionCriteriaText: "I meet them",
    questionnaireAnswers: [{ questionId: "q1", answers: [{ id: "o1", text: "Yes", uri: null }] }],
    mostRecentRole: { company: "Acme", title: "Accountant", started: { year: 2020, month: 1 } }, priorityApply: "Pending",
  }), { offlineOnly: true }],
];

export async function loadModules() {
  const [api, apply, jobs, activity, sections, settings, companies, directory] = await Promise.all([
    import("../dist/api.js"), import("../dist/apply.js"), import("../dist/jobs.js"), import("../dist/activity.js"),
    import("../dist/profile-sections.js"), import("../dist/settings.js"), import("../dist/companies.js"), import("../dist/directory.js"),
  ]);
  return { api, apply, jobs, activity, sections, settings, companies, directory };
}
