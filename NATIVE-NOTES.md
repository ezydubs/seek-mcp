# Seek NZ: native-request notes

Findings from watching nz.seek.com's own network traffic in a browser (2026-10-04 and 2026-10-05) and from
the site's own apply bundle (`/static/jobapply/main-*.js`), for a server that uses plain Node `fetch`
and no browser. Everything below has been exercised with native `fetch` unless marked otherwise.

## Domain

`seek.co.nz` redirects to `https://nz.seek.com`. Use the new domain directly.

## Search (no login): tested, works

`GET https://nz.seek.com/api/jobsearch/v5/search`

| Param | Value |
|---|---|
| `siteKey` | `NZ-Main` |
| `locale` | `en-NZ` |
| `keywords` | free text |
| `where` | e.g. `All Auckland`, `Wellington` |
| `page`, `pageSize` | 1-based page; size up to ~100 |
| `sortmode` | `KeywordRelevance` or `ListedDate` |
| `worktype` | comma list: 242 full time, 243 part time, 244 contract/temp, 245 casual |
| `daterange` | 1, 3, 7, 14, 31 (days) |
| `salaryrange` + `salarytype` | `min-max`, `annual` or `hourly` |

Response: `totalCount`, `data[]` with `id`, `title`, `advertiser.description`, `companyName`,
`locations[].label`, `salaryLabel`, `workTypes[]`, `workArrangements.displayText`,
`listingDate`, `listingDateDisplay`, `teaser`, `bulletPoints[]`, `classifications[]`.
The first rows can be paid placements (`isFeatured` / `displayType: "promoted"`) pinned above
the chosen sort.

Note: `KeywordRelevance` returned far fewer results (39) than `ListedDate` (437) for the same
query. Worth checking before relying on totals.

## Job ad (no login): tested, works

`GET https://nz.seek.com/job/<id>` returns HTML containing
`window.SEEK_APOLLO_DATA = {...};` followed by other `window.*` assignments in the same
`<script>`. The object is valid JSON; cut it at the matching closing brace (string-aware) and
`JSON.parse` it. Regex-to-`</script>` fails because more code follows.

- Details: `ROOT_QUERY['jobDetails:{"id":"<id>"}'].job` (may be inline or an Apollo `__ref`).
- Ad HTML: field whose key starts with `content2(` (zone `anz-2`).
- Other fields: `title`, `abstract`, `status`, `isExpired`, `isLinkOut`, `listedAt`,
  `expiresAt`, `advertiser` (`name(...)`, `isVerified`), `location.label(...)`,
  `workTypes.label(...)`, `salary.label`, `classifications`.
- Parameterised fields are stored under keys like `name({"locale":"en-NZ"})`; match by prefix.

## Logged-in data: GraphQL, tested with a valid token

`POST https://nz.seek.com/graphql`, headers:

- `authorization: Bearer <access token>` (Auth0, issuer `https://login.seek.com/`,
  audience `https://seek/api/candidate`, 1 h lifetime)
- `content-type: application/json`
- `seek-request-brand: seek`, `seek-request-country: NZ`

The site sends Apollo batches (a JSON array of operations) and gets an array back; a single
operation in an array works. Without the token the API answers
`{"errors":[{"extensions":{"code":"UNAUTHENTICATED"}}]}`. An expired token was still accepted
for a few minutes past `exp` (grace period). Introspection is disabled, so every operation below
was captured from the site or read out of its bundle.

Read operations:

| Operation | Variables | Use |
|---|---|---|
| `GetSavedJobs` | `first`, `locale`, `zone: "anz-2"` | `viewer.savedJobs.edges[].node` (job, createdAt, isActive, notes) |
| `GetAppliedJobs` | as above + `sortBy` | `viewer.appliedJobs.edges[].node` (job, appliedAt, events[].status) |
| `SearchSavedAndAppliedJobs` | `jobIds: [String!]!` | `viewer.searchSavedJobs[].jobId`, `viewer.searchAppliedJobs[].jobId` — saved/applied flags for a batch of jobs |
| `GetJobApplicationProcess` | `jobId`, `isAuthenticated: true` | questionnaire with option ids, `documents.selectionCriteriaRequired`, `linkOut`, `lastAppliedResumeIdPrefill` |
| `DocumentsQuery` | none | `viewer.resumes[]` with `isDefault`, `fileMetadata { name size virusScanStatus uri }` |
| `GetAttachmentMetadata` | `blobUrl` | `virusScanStatus` of one document (`Pending` → `OK`) |
| `GetRoles`, `GetQualifications`, `GetLicences`, `GetSkills` | zone/language | profile sections shown on the "Update SEEK Profile" step |

## The apply flow, as the site runs it (2026-10-05, job 95060390, walked to the review page)

1. **Choose documents** — `TrackJobApplicationStarted({jobId, sessionId, applicationCorrelationId, isProfileApply: true})`
   with two client UUIDs; `DocumentsQuery` lists résumés. Picking "write a cover letter" sends nothing yet.
2. **Answer employer questions** — purely client-side; the questionnaire came from `GetJobApplicationProcess`.
3. **Update SEEK Profile** — reads only (`GetRoles` …, `UnconfirmedDataQuery` for suggestions parsed from the résumé).
4. **Review and submit** — on the button press the site generates the written documents, then sends one
   `ApplySubmitApplication` mutation. Its input, from the bundle's own builder:

```
{
  jobId, correlationId, zone: "anz-2",
  profilePrivacyLevel: "Public" | "Private",
  resume?:            { id, uri: "/v2/blobstore/resumes/<id>/", idFromResumeResource: -1 },   // -1 is hard-coded by the site
  coverLetter?:       { writtenText, uri },     // uri from WrittenCoverLetter → generateCoverLetter({writtenText})
  selectionCriteria?: { writtenText, uri },     // uri from WrittenSelectionCriteria → generateSelectionCriteria({writtenText})
  mostRecentRole?:    { company, title, started: {year, month}, finished?: {year, month} },
  questionnaireAnswers?: [{ questionId, answers: [{ id, text, uri }] | [{ text }] }],   // option objects, or text for free-text questions
  referenceCheck?:    { id },
  priorityApply:      { state: "NotPrioritized" | "Pending" | "Prioritized" }
}
```

Optional parts are left out rather than sent as null (the site spreads them in only when present).
`questionnaireAnswers` is omitted when the job asks nothing. The privacy-policy consent is an
ordinary question answered with the option whose text is `Yes`. Response:
`submitApplication` → `SubmitApplicationSuccess { applicationId }` or `SubmitApplicationFailure { errors { message } }`.
Tested: real applications land this way and show in `GetAppliedJobs`.

## Résumé upload: tested, works

1. Choose a UUID `id` for the document.
2. `GetDocumentUploadData($id: UUID!)` → `viewer.documentUploadFormData { link key formFields { key value } }`:
   a presigned S3 POST (`link` is the bucket URL, fields `key`, `X-Amz-*`, `Policy`,
   `x-amz-meta-filename: "${filename}"` which S3 substitutes, `x-amz-meta-candidateId`).
3. `POST <link>` as `multipart/form-data`: every form field in order, then the file as `file`. Expect 204.
4. `ApplyProcessUploadedResume({ input: { id, parsingContext: { id: <another UUID> }, zone: "anz-2" } })`
   → `processUploadedResume { resume { ...resume } viewer { resumes } }`; the new résumé starts with
   `virusScanStatus: "Pending"`.
5. Poll `GetAttachmentMetadata({ blobUrl: "/v2/blobstore/resumes/<id>/" })` until `OK` (a few seconds).
6. `RequestResumeParsing({ input: { id, parsingContext: { id }, zone } })` → `ref`; feeds the profile suggestions.
7. Optional `SetDefaultResume({ resumeId: { id }, languageCode: "en" })` — the apply page does this for a new upload.

`DeleteResume({ input: { id } })` removes one; both return the refreshed `viewer.resumes`.

## Saved jobs: tested, works

- `CreateSavedJob({ input: { id: "<jobId>", zone: "anz-2" }, locale: "en-NZ" })` → `createSavedJob2` →
  `CreateSavedJobSuccess { id }` | `CreateSavedJobFailure { errors { message } }`
- `DeleteSavedJob({ input: { id }, locale })` → `deleteSavedJob2` → `DeleteSavedJobSuccess { id }` | failure

## Other operations

Since 0.4.0 the server uses the site's documents for every candidate feature; see "Finding operations" below.
Seen in the bundles and deliberately not used: tracking (`trackSelected`, `SubmitSourcrPageAnalyticsEvent`…),
feature flags, employer-side branding (`createBrand`, `updateBrand`), CMS page builds (unified-apac), the anonymous
saved-search and newsletter sign-ups, unsubscribe-by-token links, `PostProfileReport` and the company review form
(`postCompanyReviewExperiment2`, a multi-step experiment flow).

## Token renewal: tested, works

`POST https://login.seek.com/oauth/token`, JSON body:
`grant_type: refresh_token`, `client_id`, `refresh_token`,
`redirect_uri: https://nz.seek.com/oauth/callback`; header `origin: https://nz.seek.com`.

Returns a new 1 h `access_token` plus a **rotated** `refresh_token` (the old one should be
treated as used). Store the newest pair privately (mode 600) and renew from it.

## The first token

Seek keeps its sign-in in the browser's localStorage (Auth0 SPA cache), not in cookies. The server
takes that pair from the user's own Chrome profile once (`seek_auth` with `bootstrap`), renews it,
and from then on only its own copy is valid — see `src/auth.ts`.

Checked on 2026-10-05 whether a browser-free sign-in exists: the Auth0 client
(`J9jUXRpxuZz0eyKD9f2SfipRnnujjM9I`) rejects the `password`, `password-realm` and
`device_code` grants (`unauthorized_client`), and `/authorize` only accepts the site's own callback
URL. So a first token has to come from a real sign-in in a browser; there is no username/password
API to call.

## Finding operations (2026-10-12)

Introspection is disabled on the live endpoint, but every Seek web app ships its documents. Each section of the site
is its own webpack app under `/static/<app>/` (job search, job ads and the home feed: `ca-search-ui/houston`;
profile: `profile`; saved searches: `disc-static-pages`; saved and applied jobs: `my-jobs`; settings: `settings`;
privacy: `unified-apac`; apply: `jobapply`; companies: `company-candidate-ui`; People search: `candidate-basic-search`;
recruiters: `recruiter-directory-ssr`; career advice: `/career-advice/assets/`; sign-in pages: login.seek.com
`hosted-pages-deploy`). Each app's `runtime-*.js` maps its lazy chunks.

`scripts/research/`: `fetch-app.mjs` downloads an app and all its chunks; `extract-gql.mjs` reads the compiled
`{kind:"Document",definitions:[…]}` literals as data with a small literal parser (nothing is executed) and prints them
with graphql-js; `catalog.mjs` adds string-form (`gql` template) documents, resolves fragments by name and writes one
catalogue (351 operations); `gen-documents.mjs` copies the documents the server uses into `src/documents.ts`;
`extract-schema.mjs` pulls the introspection result the company and recruiter apps embed
(`JSON.parse('{"__schema":…}')`, about 1,360 types) into `test/fixtures/seek-schema.json.gz`.

The embedded schema is a little older than the live one (e.g. `content2`, `salaryMatch`, `preferredRoleTitleList`,
`lastCoverLetterMethod` are newer), so the live server stays the authority. Two ways to check a request without
a sign-in:

- **Offline**: validate the document and coerce the variables against the schema (`test/requests-schema.test.mjs`).
- **Live**: send it with no authorization header. Seek validates documents and variables before running resolvers, so a
  well-formed request gets `UNAUTHENTICATED` and does nothing, and a malformed one gets `BAD_USER_INPUT` /
  `GRAPHQL_VALIDATION_FAILED` naming the field (`Field "x" of required type "T!" was not provided`, `Field "y" is not
  defined by type "T"`). Sending empty inputs this way lists a type's required fields. Never do this with operations
  that may run anonymously (reports, recruiter messages, review feedback, newsletter sign-ups). `scripts/check-shapes.mjs`.

Several mutations report failure as a typed result rather than an error (for example an unauthenticated
`updatePreferredLocations2` returns `UpdatePreferredLocations2Failure { error { message } }` with HTTP 200), so every
mutation result is checked for `…Failure`, `error` and `errors`.

## Search: more filters (tested)

`jobsearch/v5/search` also takes `classification` and `subclassification` (comma lists of ids from
`getClassificationOptions`), `workarrangement` (1 on-site, 2 hybrid, 3 remote), `advertiserid`, `companyid` (a company's
**organisation id**, e.g. Kiwibank 2945, from the company profile; the company page id does not work) and
`facets=workType,workArrangement` (counts by id). The response's `location.whereId` is the id Seek resolved `where` to
(1018 All Auckland); company review and salary lookups take that same id. Results carry `workArrangements.data[]`,
`tags[]` (e.g. `URGENT` "Immediate start") and classification ids.

## Job ad over GraphQL (no login, tested)

The houston `jobDetails` document works signed out: ad HTML (`content(platform: WEB)`), phone number and
`contactMatches`, advertiser id/verification/registration date, work arrangements, badges, `products.questionnaire`
(the employer's questions as text), bullets, video, share link, and `companyProfile` (id, slug, rating, size, perks).
`insights` (applicant count) needs a sign-in and `isAuthenticated: true`. `JobDetailsRecommendedJobs` (similar jobs)
and `getJobDetailsBadges` are public. Signed in: `jobDetailsPersonalised` (saved/applied, salary match, Seek's AI
`candidateJobMatch`), `GetMatchedQualities` (matched / inferred / unmatched skills), `createCandidateJobMatchRequest`
(`{ jobId, channel: "chalice", platform: WEB, visitorId }`), `GetAppliedJobDetail` (applicant count and résumé /
cover-letter percentages). `CreateReportedJob`: `{ jobId: Int, reason: Fraudulent | Discrimination | Misleading |
SalaryBelowMinimumWage, comment (≤400), email, country }`.

## Autocomplete and ids (no login, tested)

`getKeywordSuggestions`, `searchLocationsSuggest`, `getProfileLocationSuggest` (`locationType: Home`; numeric ids such as
Ponsonby 30182, used by `UpdatePersonalDetails` and `UpdatePreferredLocations2`), and the ontology lookups
`getRoleTitle`, `getOrganisations`, `getEducationProviders`, `getQualifications`, `getSpecReqs` (`profileField: Skills |
LicencesCertifications | LanguageProficiency`), `getRightToWorkOptions`. Profile values go back as
`OntologyStructuredDataInput { text, ontologyId }`, with `ontologyId: null` for free text. Option lists:
`GetAvailabilityOptions` (0, 2, 4, 8, 12 weeks), `GetWorkTypeOptions` (1–4), `GetProfileVisibilityOptions` (Public,
Standard, Limited, Hidden), `getClassificationOptions`.

## Profile sections (signed in; shapes checked live)

Reads: `GetCareerObjectives`, `GetConfirmedRoles` / `GetUnconfirmedRoles`, `GetConfirmedQualifications` /
`GetUnconfirmedQualifications`, `GetLicences`, `GetSkills` / `GetSuggestedSkills`, `GetLanguageProficiencies`,
`GetAvailability`, `GetWorkTypes`, `GetPreferredLocations2`, `GetPreferredClassification`, `GetPreferredRoleTitleList`,
`GetSalaryPreferences`, `GetRightsToWork`, `GetApproachability`, `GetProfileVisibility2`, `GetProfileAvatar`,
`GetScore`, `GetProfileInsights`, `getVerifications`, `getReferenceChecks`, `GetPublicProfile`.

Writes (input → notes):

| Mutation | Input |
|---|---|
| `UpdateCareerObjectives` | `careerObjectivesData { personalStatement }` |
| `DeleteRole` / `ConfirmRole` / `RejectRole` | `{ id }`; confirm re-sends the suggestion as `UpdateRoleInput` plus `contextId` = the résumé it was parsed from |
| `UpdateQualification` / `ConfirmQualification` | `{ id, name, institute, completed, completionYear? , expectedCompletionDate?, highlights? }` |
| `RejectQualification` | `{ id, dataType: Education }` |
| `UpdateLicence` / `DeleteLicence` | `{ id, name, issuingOrganisation?, issueDate?, expiryDate?, noExpiryDate, description? }` / `{ id }` |
| `UpdateSkills` | `skillsData { skills: [{ keyword: { text, ontologyId } }] }` (the whole list) |
| `UpdateLanguageProficiency` / `DeleteLanguageProficiency` | `{ id, name }` / `{ id }` |
| `UpdateAvailability` | `availability { id: Int }` |
| `UpdatePreferredWorkTypes` | `workTypesData { ids: [Int] }` |
| `UpdatePreferredLocations2` | `{ preferredLocations: [{ id: Int }] }` |
| `UpdatePreferredClassification` | `{ classification: { id, subClassification: { id } } }` |
| `UpdatePreferredRoleTitleList` | `{ add: [{ title, ontology? }], remove: [{ title }] }` |
| `UpdateSalaryPreferences` | `{ salaryPreferences: [{ id: UUID, countryCode, amount, salaryType: Annual \| Monthly \| Hourly }] }` |
| `UpdateRightsToWork` | `{ rightsToWork: [{ id: UUID, countryCode, type2: { id: <option id> } }] }` |
| `UpdateApproachability` | `approachability { approachable }` |
| `UpdateProfileVisibility2` | `{ id: Public \| Standard \| Limited \| Hidden }` |
| `CreateProfileAvatar` → PUT `uploadUrl` → `GetProfileAvatarStatus` | photo upload; `DeleteProfileAvatar` |
| `GenerateResumeFromProfile` | `{ zone, languageCode }` |
| `DocumentDownloadLink` | `resourceId` and `resumeId` both the résumé id |

`UpdatePersonalDetails` always sets the location as well (`updateCurrentLocation2`), so to keep it the current
`currentLocation2.id` has to be re-sent. Versions before 0.4.0 sent 30010 (Auckland CBD) whenever no location was given.

## Activity (signed in; shapes checked live)

- Saved searches: `GetSavedSearches` (`viewer.apacSavedSearches`), `CreateApacSavedSearch({ searchQueryString, zone })`
  where the query string uses the search URL's parameter names (`keywords=…&where=…&worktype=242`),
  `DeleteApacSavedSearch({ id })`, `UpdateSavedSearchEmailAlert(id, allowEmailAlert)`.
- Notes: `SetSavedJobNotes` / `SetAppliedJobNotes({ id, notes })`, `RemoveSavedJobNotes` / `RemoveAppliedJobNotes(jobId)`.
- `DeleteAppliedJob({ id })` removes an application from the list; it does not withdraw it.
- `GetResumeLink` / `GetCoverLetterLink(jobId)`: download links for the documents an application sent.
- Priority apply: `GetPriorityApplyCredit` (`credit2` is `PrioritizedCredit` for identity-verified candidates, else
  `PendingCredit`); `MarkAsPreferredApplication({ applicationRequestId, state })` with state `Prioritized` or `Pending`
  to match; `submitApplication` takes the same as `priorityApply.state`.
- Recommendations: `GetRecommendedJobs` (career feed, `components: ["JOB"]`); each job's `feedbackReasons` carry
  `saveJobPreferencesArgs { reason, typeId }` for `SaveJobPreference([…])`; `CandidateJobPreferences` lists them and
  `DeleteJobPreferences([{ id }])` undoes one.
- Off-site jobs: `createApplyLinkout(jobId)` → `createLinkoutApplication { applicationUrl }`, recorded in Applied jobs.
- Uploaded cover letters / selection criteria: `GetDocumentUploadData` + presigned S3 POST (as résumés), then
  `processUploadedAttachment({ id, attachmentType: CoverLetter | SelectionCriteria })` → `uri`, sent as `coverLetter { uri }`.

## Settings (signed in; shapes checked live)

- Notifications: `GetCTPPreference` lists groups → products (`NotificationCtpPreferenceProductType`, e.g. `SavedSearch`,
  `NewJob`, `AppViewed`, `MarketingNewsletter`) → channel subscriptions; `updateNotificationCtpPreferences({
  onlyProductionOption: true, zone, preferences: [{ id, notificationsChannel: [{ channel: email|push, frequency?,
  subscribe, reason: preferenceUI }] }] })`.
- Email: `changeEmailStart({ newEmailAddress })` emails a code; `changeEmailVerify({ newEmailAddress, verificationCode,
  brand: seek, country: NZ, language: en })` completes it.
- `deleteAccount({ accountDelete: {} })`: no confirmation input at all, so the tool demands the account email.

## Companies (no login, tested)

`SearchCompanies(name)` → `companyId` (the number at the end of the profile slug) and `organisationId`.
`GetCompanyDetailAndReviewSummary`: overview, culture, perks, awards, `companyReviewRating` by category and star, and
`companyReviewsAISummary`. `CompanyReviews` takes the id twice (`companyProfileId`, `newCompanyProfileId`); `sort` is
`""` for most recent or `"-upvote_count"` for most helpful (other values return nothing); `locationId` is the search
`whereId`. `CompanyReviewLocations`, `GetCompanySalaryRange`. A company's jobs are the search with `companyid=<organisationId>`.
Signed in: `PostCompanyProfileReviewUpvotes({ companyId, reviewId })`, `PostCompanyProfileReviewFlag({ companyId,
reviewId, reason: spam | disagree | personal_info | offensive | sensitive | response_inappropriate | bias | others, details })`.

## Career advice (no login, tested)

A separate endpoint, `https://career-guide-api.cloud.seek.com.au/graphql`, localised by headers `country: NZ`,
`language: en`, `seek-request-country: NZ`, `x-seek-site: skl-career-guide-site` (without them the content is
Australian). Roles go by alias (`accountant`): `GetRole` (`specReqInput: { size }`), `GetRoleTasksAndDuties`,
`GetRoleWhatsItLike`, `GetHowToBecome`, `GetRoleSpecReqs`, `GetRoleReviewStats`, `GetWorkHours`, `GetRoleGrowth`,
`GetSimilarRoles`, `GetRoleReviews(roleId: alias)`. Salaries: `GetSalarySuggestionByRoleAndLocation(role_id, roleTitle,
locationId, salaryType?)` with locationId 3001 for New Zealand or a search `whereId` for a region (1018 Auckland),
`salaryType: HOURLY` for rates; `GetRoleClassSalariesById` by industry. Search: `AutoSuggestV2({ term, filter: { type:
ROLE } })`, `SearchV2` / `SearchV2Articles`. Articles: `GetArticleV2(alias)`, `GetLatestArticles`. Explore:
`Classifications` → `GetRolesByClassificationUrl(segment)`.

## Recruiter directory (no login, tested)

On `nz.seek.com/graphql` under `sourcr`. `SearchRecruiter` / `SearchAgency({ input: { query, pagination: { cursor, pageSize },
filters, withBoost: true, visitorId } })`: the cursor is 1-based (0 gives INTERNAL_SERVER_ERROR), and the site always
sends `LAST_REVIEW_DATE: [last12Months]` and `COUNTRY: ["New Zealand"]`; `POSTCODE` takes a region's postcode ranges from
`GetFiltersData`, plus `SPECIALISATIONS`, `ROLE_TYPES`, `PLACEMENT_TITLES`. Profiles: `SeekDirectoryRecruiterProfileDetails` /
`SeekDirectoryAgencyProfileDetails`, `GetRecruiterReview` / `GetAgencyReview`, `PaginatedJobs`, `PaginatedPlacements`,
`GetTeamData`. `ContactRecruiterByEmail({ message, slug, type, name, email, number?, country: NZ, jobId? })`.

## People search (no login, tested)

`PublicProfileSearch({ input: { searchQuery, market: NZ, pageNumber, pageSize, locations: { values }, roleTitles: { values,
matchLatestOnly }, companies: { values, matchLatestOnly }, visitorId } })`, `locations` required; it matches names.
`PublicProfileView({ input: { slug } })`; signed out some profiles come back as `RestrictedPublicProfileView`.

## Sign-in findings (2026-10-12)

- A refresh token unused for about a week stops renewing: `invalid_grant` "Unknown or invalid refresh token".
- The sign-in page's "Email me a sign in code" is Auth0 passwordless (`/passwordless/start` with `send: link`), and Seek's
  tenant answers `recaptcha_required` without a reCAPTCHA token, so it cannot be driven without a browser.
- The authorize request the site makes: `response_type=code`, `response_mode=query`, PKCE S256,
  `redirect_uri=https://nz.seek.com/oauth/callback/` (trailing slash), scope `openid profile email offline_access`,
  audience `https://seek/api/candidate`.
