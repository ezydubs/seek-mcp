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

## Other mutations seen in the bundle (not used here)

`UpdateSkills`, `UpdateQualification`, `DeleteQualification`, `ApplyAddLicence`/`ApplyUpdateLicence`/`ApplyDeleteLicence`,
`CreateProfileAvatar` (returns an `uploadUrl` for a PUT), `ApplyProcessUploadedAttachment` (uploaded cover
letters/selection criteria → `uri`), `ConfirmRole`/`RejectRole`/`RejectUnconfirmedData` (résumé-parsed suggestions),
`createApplyLinkout` (off-site jobs: `createLinkoutApplication { applicationUrl }`).

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
