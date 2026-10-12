# seek-mcp

An [MCP](https://modelcontextprotocol.io) server for **Seek New Zealand** (nz.seek.com). It lets an MCP client such as Claude Code or Claude Desktop do what the website does: search jobs and read full ads, research companies (profiles, employee reviews, salaries), read Seek's career guide and salary insights, browse the recruiter directory and People search, manage every part of the signed-in profile and its résumés, keep saved jobs, saved searches and notes, tune recommendations and notifications, and submit applications.

Everything runs over Seek's own HTTP API with plain Node `fetch`. There is no browser, no Puppeteer and no Playwright at runtime: the server sends the same GraphQL documents the Seek website sends, copied verbatim out of the site's own JavaScript bundles (`src/documents.ts`), and checks every request it builds against the schema those bundles ship. How the operations were found is documented in [NATIVE-NOTES.md](NATIVE-NOTES.md).

> **This is an unofficial tool.** It is not affiliated with or endorsed by SEEK. Automating your account may be against Seek's terms of use, applications it submits are real and cannot be withdrawn, and you are responsible for the truthfulness of every answer it sends on your behalf. Use it on your own account, at your own risk.

## Why this exists

Built by [ezydubs](https://github.com/ezydubs), who got tired of watching decent applications vanish into screening software and decided the only fair answer was to put the same kind of automation on the applicant's side. The method is simple: **use AI to beat AI.** Employers already use it to rank hundreds of CVs in seconds and to run first-round interviews; this gives job hunters an assistant that can search, read every ad properly, answer the screening questions exactly, write a tailored cover letter and apply, free and open source, with the same honesty rules it enforces on itself. Yes, that makes him a bit of a legend. He said so himself, and the applied-jobs list agrees.

"Beat" does not mean spam. The tool refuses jobs you have already applied to, will not guess an answer, and dry-runs everything before it sends. It exists so a real person can show up to every role they genuinely fit with a complete, honest application, at the speed the screeners read them.

### The job market this was built for (New Zealand, 2025–2026)

> "The unemployment rate was 5.6 percent in the June 2026 quarter, compared with 5.4 percent in the March 2026 quarter."
> — Abby Johnston, labour market spokesperson, [Stats NZ, 5 August 2026](https://www.stats.govt.nz/news/unemployment-rate-at-5-6-percent-in-the-june-2026-quarter/). RNZ called it an [11-year high](https://www.rnz.co.nz/news/business/892951/unemployment-rises-to-11-year-high-of-5-point-6-percent): 166,500 people unemployed, and underutilisation among 15–24-year-olds up to 37 percent.

> "As of November 2025 ... relative to November 2019 ... we have seen a 243 percent increase in the number of applicants per job ad on the Seek site, at least."
> — Brad Olsen, Infometrics chief executive, in [RNZ, 18 February 2026](https://www.rnz.co.nz/news/business/587129/company-boss-shocked-as-2500-apply-for-one-job). The same story: Oppo's managing director "would usually consider 500 a high number of applicants for a job ad", then watched one central-Auckland customer service ad pass 2,500 applications.

> "Sheryl has applied for 90 jobs since being made redundant last November. Despite decades of experience in human resources and being desperate to work, so intense is the competition for jobs that she's struggled to even get a response to many of her applications." ... "It's demoralising, your self-worth takes a hit, self-doubt starts to creep in."
> — [RNZ, 6 August 2026](https://www.rnz.co.nz/news/business/900576/job-seekers-describe-fear-and-frustration-as-unemployment-soars). In the same piece a 22-year-old graduate had sent almost 200 applications for about six interviews, and a nurse with 37 years' experience put it this way: "They don't tell you when they email you back, they don't tell you why you didn't get the job, they just say 'We're so sorry and thank you for your application', so you never know."

> "If you've had 200 people apply for a role, you need to be able to quickly comb that down and rank those employees, so the AI does that and gives you a shortlist." ... "Unfortunately for all the job hunters out there, there is a lot more people looking for jobs than jobs are going."
> — Neil Webster, Employment Hero chief executive, in [1News, 21 May 2026](https://www.1news.co.nz/2026/05/21/ai-is-interviewing-thousands-of-kiwi-job-seekers-so-i-gave-it-a-try/), which reported more than 2,500 AI-led job interviews run by that one company in April alone.

> "More than a third of employers said AI-generated CVs are making it difficult to assess talent quality (36%)", while "automated screening tools tend to miss strong job candidates (37%)".
> — Robert Half survey of New Zealand employers, reported by [HRD New Zealand, 6 February 2026](https://www.hcamag.com/nz/specialisation/hr-technology/automation-failures-are-driving-hiring-challenges-in-new-zealand/564457). The screeners are missing good people, by their own users' account.

> "There's no way that you can deal with that type of application level."
> — Liza Viz, Beyond Recruitment chief executive, on an administration role that drew about 1,200 applications in two days, in [The Spinoff, 24 February 2025](https://thespinoff.co.nz/society/24-02-2025/one-position-1200-applications-a-snapshot-of-new-zealands-job-market-right-now). One job hunter in the same article, after a year of searching: "I don't want to look at another job app, write another cover letter. Oh god, it's like nightmare fuel."

That last quote is the problem this solves. Writing the fortieth tailored cover letter is nightmare fuel; the software reading it on the other side never gets tired. Now neither do you.

## Contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Connect it to an MCP client](#connect-it-to-an-mcp-client)
- [Signing in](#signing-in)
- [Tools](#tools)
- [Applying safely](#applying-safely)
- [Standing answers](#standing-answers)
- [Actions that need confirmation](#actions-that-need-confirmation)
- [Files and environment](#files-and-environment)
- [Development](#development)
- [How it works](#how-it-works)
- [License](#license)

## Features

- **Search and read without signing in**: keywords, location, work type, work arrangement (on-site, hybrid, remote), classification and subclassification, listing date, salary, one advertiser or one company; counts by work type and arrangement; Seek's refinement pills for a search. Full ads come with the employer's screening questions, contact details in the ad, badges, the advertiser's history on Seek and the company's rating.
- **Companies**: profile, culture, perks and awards, employee ratings by category, Seek's AI summary of reviews, every review (filter by location, sort by recent or helpful), salary ranges by role, the company's open jobs and its Graduates tab; browse companies by industry.
- **Career advice and salaries**: Seek's career guide for any role (what it's like, duties, skills, how to become one, satisfaction and hours, growth, similar roles), salary insight New Zealand-wide or by region, annual or hourly, by industry, role reviews, career pathways to next roles with live job counts, roles that use given skills, role counts by industry and interest theme, careers by classification, the advice articles (latest, featured, popular, by category) and the Career Compass quiz with its AI recommendations.
- **Recruiters and people**: the recruiter and agency directory (search by placements, specialisation and region; featured recruiters and agencies; profiles, reviews, jobs, placements, teams and awards; email a recruiter or record a call) and People search over public candidate profiles.
- **Apply natively**: the same `submitApplication` mutation the website sends, with résumé, a written or uploaded cover letter, written or uploaded selection criteria, the profile's most recent role, every employer question answered by exact option id, and optional strong interest (priority apply). Dry-run mode prepares everything and sends nothing. Off-site jobs can be recorded in Applied jobs.
- **Answer employer questions deliberately**: human-readable answers are matched against the live questionnaire and must resolve to exactly one option; anything unmatched, ambiguous or duplicated is an error rather than a guess. Standing answers fill the standard work-rights, notice-period and salary questions.
- **The whole profile**: personal details, summary, career history (add, edit, delete, accept or dismiss résumé suggestions), education, licences and certifications, skills (with Seek's suggestions), languages, next-role preferences (availability, work types, locations, classification, role titles, salary, rights to work), approachability, visibility, photo, profile strength and Seek's suggestions, activity and verifications (verified licences and qualifications are edited the way Seek allows); résumés (upload with Seek's virus scan, delete, set default, download, generate one from the profile).
- **Your activity**: saved jobs, saved searches and their email alerts, notes on saved and applied jobs, applied jobs with the documents sent and applicant insights, priority-apply credits, recommendations and "not interested" feedback, the home feed (AI job summaries, market insights for your role and location, profile performance) and refining recommendations by answering Seek's questions, the salary and market-insight prompts, and Seek's AI assessments of a job (job match, strong fit, how to stand out).
- **Settings**: email and push notification preferences, changing the sign-in email, and (guarded) deleting the account.
- **Self-renewing sign-in**: a one-time hand-over from your own Chrome profile, then automatic renewal; tokens live in a mode-600 file outside the repo.

## Requirements

- **Node.js 22.13 or newer** (uses the built-in `fetch`, `FormData`, `Blob` and `node:test`).
- **macOS** for the one-time Chrome sign-in hand-over (`seek_auth` with `bootstrap`). Everything else is platform-independent.
- **Google Chrome** signed in to nz.seek.com, for that same hand-over.

No other binaries. PDF CVs are read with Mozilla's pure-JavaScript [pdf.js](https://github.com/mozilla/pdf.js) and DOCX files with Node's built-in `zlib`.

## Install

```bash
git clone https://github.com/ezydubs/seek-mcp.git
cd seek-mcp
npm install
npm run build        # compiles src/ to dist/
npm test             # builds and runs the unit tests
```

The server binary is `dist/server.js` (also exposed as the `seek-mcp` bin). It speaks MCP over stdio.

## Connect it to an MCP client

**Claude Code**

```bash
claude mcp add seek -- node /absolute/path/to/seek-mcp/dist/server.js
```

**Claude Desktop** (`claude_desktop_config.json`) or any other stdio MCP client:

```json
{
  "mcpServers": {
    "seek": {
      "command": "node",
      "args": ["/absolute/path/to/seek-mcp/dist/server.js"]
    }
  }
}
```

Restart or reconnect the client after rebuilding: a running server keeps the code it started with.

## Signing in

The tools marked "no" below work without an account. Every other tool needs Seek's sign-in.

1. Sign in to nz.seek.com in Google Chrome (the `Default` profile unless `CHROME_PROFILE` says otherwise).
2. Ask the client to run `seek_auth` with `bootstrap: true`. The server copies Seek's sign-in out of that Chrome profile once, renews it, and stores the result in `~/.seek-mcp/tokens.json` with mode 600.
3. From then on the server renews the sign-in by itself. `seek_auth` with no arguments reports whether a usable sign-in is held and when it expires; `check: true` asks Seek which account it is; `logout: true` revokes and deletes it.

Things to know:

- Seek rotates the sign-in on every renewal, so the copy Chrome held becomes stale after the hand-over and **Chrome will usually ask you to sign in again**. That is expected. Do not run the bootstrap again unless `seek_auth` reports the server signed out, or you deliberately want the server to take over whichever account Chrome is on now.
- **An unused sign-in lapses after about a week.** Seek's identity provider stops renewing a refresh token that has not been used for roughly seven days (`invalid_grant`). `seek_auth` then reports `signedIn: false` with the reason; sign in to nz.seek.com in Chrome and bootstrap again.
- The server acts as **whichever account Chrome was signed into at bootstrap time**. If you have more than one Seek account, check `seek_profile` (it returns the account email) before applying to anything.

There is no username/password or email-code sign-in for the server: Seek's identity provider refuses those grants for this client, and its email-code login requires a reCAPTCHA, so a real browser login has to exist first.

## Tools

62 tools. "no" in the sign-in column means it works without an account.

### Jobs

| Tool | Sign-in | What it does |
|---|---|---|
| `seek_search` | no | Search ads. `keywords`, `where`, `workType[]`, `workArrangement[]` (on_site/hybrid/remote), `classification[]`/`subclassification[]` ids, `listedWithinDays`, `salaryMin`/`salaryMax`/`salaryType`, `advertiserId`, `companyId` (organisation id), `page`, `pageSize` (≤100), `sort`. Returns facets and flags paid placements (`promoted`). |
| `seek_job` | no | Full ad: description, advertiser, location, salary, work type and arrangement, classification, dates, status, bullets, badges, the employer's questions, contact details, company profile summary, `externalApply`. Signed in it adds the applicant count and salary match. |
| `seek_similar_jobs` | no | The jobs Seek recommends alongside an ad. |
| `seek_suggest` | no | Autocomplete and id lookup: keywords, search locations, profile locations (numeric ids), role titles, companies, schools, qualifications, skills, licences, languages (ontology ids), rights to work; `search_refinements` gives Seek's refinement pills for a search (`query` = keywords, optional `where`), each with the keywords to search next. |
| `seek_classifications` | no | Classifications and subclassifications with ids, and the availability, work-type and visibility options. |
| `seek_job_insights` | yes | Saved/applied, matched/inferred/missing skills, salary match, applicant insights, and Seek's AI assessments: job match, strong fit (the candidate's strengths for the role) and stand out (three ways to stand out, a tailored summary). `requestAiMatch`, `requestStrongFit` and `requestStandOut` run them; each uses one of the account's AI allowances. |
| `seek_report_job` | either | Report an ad (Fraudulent, Discrimination, Misleading, SalaryBelowMinimumWage). Needs `confirm: true`. |
| `seek_recommended_jobs` | yes | The recommended-jobs feed, with each job's "not interested" reasons. |
| `seek_job_feedback` | yes | Hide jobs by those reasons, unhide, or list what is hidden. |
| `seek_home_feed` | yes | The home feed: recommended jobs with AI summaries and "not interested" reasons, company highlights, market insights for a role and location (open roles, ad-volume trend; `market` reads another), profile performance, the salary prompt and `recsServiceToken`. `refinementToken` shows a refined feed; `careerInsights` adds Seek's career-insight suggestions. The feed often holds 100 or more jobs, so they come 20 at a time (`page`, `pageSize`) with `totalJobs`. |
| `seek_refine_recommendations` | yes | Seek's questions for better recommendations; `answers` submits them and returns the re-ranked jobs and a `refinementToken`; `followUp` asks follow-up questions instead. |
| `seek_home_nudges` | yes | The salary prompt and the market-insights role and location; `salaryAnswer`, `marketInsights` (role URI + location id), `confirmProfileUpToDate`. |

### Applying and activity

| Tool | Sign-in | What it does |
|---|---|---|
| `seek_apply_requirements` | yes | `externalApply`, `alreadyApplied`, `saved`, `selectionCriteriaRequired`, every employer question with its kind, text and exact options, and `verificationNudges` (Seek's prompts to verify an identity or credential for the job, with the link). |
| `seek_apply` | yes | Prepare (`submit: false`) or send (`submit: true`) an application. See [Applying safely](#applying-safely). |
| `seek_apply_external` | yes | Record an off-site job in Applied jobs and get the employer's application address. |
| `seek_standing_answers` | — | Read or set the standing answers (see below). |
| `seek_saved_jobs` | yes | The saved-jobs list, with notes. |
| `seek_save_job` / `seek_unsave_job` | yes | Save or unsave a job by id. |
| `seek_applied_jobs` | yes | Applications with dates, documents included, status history and notes. |
| `seek_application` | yes | One application: documents sent (download links) and applicant insights; `credits`, `prioritise` (strong interest), `remove` from the list. |
| `seek_job_note` | yes | Write or clear the note on a saved or applied job. |
| `seek_saved_searches` | yes | List, create (from search filters), delete, and switch email alerts on or off. |

### Profile

| Tool | Sign-in | What it does |
|---|---|---|
| `seek_profile` | yes | Account id and email, name, phone, location, résumés and roles; `sections` adds any of summary, roles, suggestedRoles, education, suggestedEducation, licences, skills, suggestedSkills, languages, availability, workTypes, preferredLocations, preferredClassification, preferredRoleTitles, salary, rightsToWork, approachable, visibility, avatar, strength, suggestions, activity, verifications, references, publicProfile, resumePrivacy (or `all`). Verified licences and qualifications carry `verified: true`. |
| `seek_profile_update` | yes | First/last name, phone (`countryCallingCodeId`, NZ = `"159"`) and optionally `locationId` (omit to keep the current one). |
| `seek_profile_summary` | yes | The personal summary. |
| `seek_add_role` | yes | Add a career-history role, or pass an existing `id` to update it. |
| `seek_role_manage` | yes | Delete a role, or accept / dismiss a role suggested from a résumé. |
| `seek_education` | yes | Add, update, delete, accept or dismiss qualifications. A verified one only takes `highlights`; deleting it is refused with the verifier's link. |
| `seek_licence` | yes | Add, update or delete licences and certifications. A verified one only takes `description`; deleting it is refused with the verifier's link. |
| `seek_skills` | yes | List (with suggestions), set, add or remove skills. |
| `seek_language` | yes | Add or delete languages. |
| `seek_preferences` | yes | Read or set availability, work types, preferred locations, classification, role titles, minimum salary, rights to work, approachability and visibility. |
| `seek_avatar` | yes | Upload (JPG/PNG) or delete the profile photo. |
| `seek_resume_upload` | yes | Upload a PDF/DOC/DOCX/TXT/RTF résumé, wait for Seek's virus scan, optionally make it the default (default true). |
| `seek_resume_delete` / `seek_resume_set_default` | yes | Delete a résumé, or make one the default. |
| `seek_resume_download` | yes | A download link for a résumé. |
| `seek_resume_generate` | yes | Have Seek build a résumé from the profile. |
| `seek_cv_read` | no | Text of a local PDF, DOCX or text CV. Extraction only. |

### Account

| Tool | Sign-in | What it does |
|---|---|---|
| `seek_auth` | — | Status; `check`, `bootstrap` (one-time Chrome hand-over), `logout`. |
| `seek_notifications` | yes | List or change email/push notifications per type and channel, with frequency. |
| `seek_change_email` | yes | Change the sign-in email: send a code, then verify it. |
| `seek_delete_account` | yes | Permanently delete the account; needs the account's exact email as `confirmEmail`. |

### Companies

| Tool | Sign-in | What it does |
|---|---|---|
| `seek_company_search` | no | Company profiles by name, with ids, ratings and review counts; `industry` (an id such as `I0008`, or a name) browses an industry's companies, and `industries` lists them. |
| `seek_company` | no | Profile, ratings by category, AI review summary, `organisationId`, `industryId`; `section: "graduates"` gives the Graduates tab (programmes, application steps, stories, videos, graduate jobs). |
| `seek_company_reviews` | no | Reviews, by page, sorted by recent or helpful, optionally for one location. |
| `seek_company_salaries` | no | Salary ranges by role against the industry. |
| `seek_company_jobs` | no | The company's open jobs. |
| `seek_company_review_feedback` | yes | Mark a review helpful or report it. Needs `confirm: true`. |

### Career advice

| Tool | Sign-in | What it does |
|---|---|---|
| `seek_career_search` | no | Roles and advice articles; `suggest` for quick role completions. |
| `seek_career_role` | no (`reason`: yes) | The career guide for a role, with live job counts by `region`; `section` `pathways` (next roles, optionally in a `differentField` or within a salary lift, with open jobs for each), `jobs` (the latest Seek jobs for the role), `reason` (why Career Compass recommended it). |
| `seek_career_salary` | no | Salary insight for a role, nationwide or by region, annual or hourly, by industry. |
| `seek_career_reviews` | no | What people in the role say about it. |
| `seek_career_explore` | no | Classifications, or a classification's roles; `skills` finds roles that use given skills; `counts` counts roles by industry and interest `theme`, with salary, satisfaction and growth filters. |
| `seek_career_article` | no | Read an article, or list the latest, `featured` or `popular` ones, or a `category`'s. |
| `seek_career_quiz` | last step | Seek's Career Compass quiz one `step` at a time with the `answers` so far; the last step returns AI role recommendations with reasons, and `reason`, `hide` and `unhide` act on one. The recommendations and those actions need a sign-in. |

### Recruiters and people

| Tool | Sign-in | What it does |
|---|---|---|
| `seek_recruiter_search` | no | Recruiters or agencies by name, placements, specialisations, role types and region; `filters` lists the values; `featured` gives the directory's featured recruiters or agencies. |
| `seek_recruiter` | no | A recruiter's or agency's profile, reviews, jobs, placements, team or awards. |
| `seek_contact_recruiter` | either | `method: "email"` messages a recruiter through the directory; `method: "call"` (signed in) records the call the way the site's Call button does and returns the number to ring. Needs `confirm: true`. |
| `seek_people_search` | no | Public candidate profiles by name, narrowed by role titles, companies and locations. |
| `seek_person` | no | One public profile. |

### `seek_apply` arguments

| Argument | Meaning |
|---|---|
| `id` | Seek job id (numeric string). |
| `submit` | **Required.** `false` prepares and sends nothing; `true` submits the application for real. |
| `answers[]` | One entry per employer question: `{ question, option }` for choice questions (`option` is the option's text, or an array for multiple-choice), `{ question, text }` for free-text questions. `question` is any fragment of the question text; it must match exactly one question, and `option` exactly one option. |
| `coverLetterText` / `coverLetterPath` | A written cover letter, or a file to attach. Omit both for none. |
| `selectionCriteriaText` / `selectionCriteriaPath` | Written or attached selection criteria; one is required when `seek_apply_requirements` reports `selectionCriteriaRequired`. |
| `resumeId` | Defaults to the profile's default résumé; `null` sends no résumé. |
| `strongInterest` | Spend a priority-apply credit to flag strong interest (`seek_application` action `credits` shows what is left). |
| `profilePrivacyLevel` | `Public` (default) or `Private`. |

Both modes return the résumé used, whether documents were prepared, the most recent role Seek will attach, the standing answers that were auto-filled and the resolved option for every question. `submit: true` additionally returns Seek's `applicationId`.

## Applying safely

- **Always dry-run first.** `submit: false` runs the full preparation (questionnaire resolution, document generation) and returns exactly what would be sent. Nothing reaches the employer.
- **Submissions are irreversible.** Seek has no withdraw. The tool refuses jobs the account has already applied to and jobs that take applications off Seek (`externalApply`).
- **Every question must be answered, honestly.** Unmatched, ambiguous or duplicated answers fail loudly instead of guessing. Privacy-policy consent questions are ordinary questions and are never filled automatically: pass `{ question: "privacy policy", option: "Yes" }` yourself when you mean it.
- **Know which account you are on.** `seek_profile` shows the email. Applications go to that account and its notification inbox.

## Standing answers

Seek asks the same three screening questions on most jobs. `seek_standing_answers` stores your answers so applications can go out unattended; they are the user's own declarations and the tool never invents others.

```jsonc
// seek_standing_answers arguments
{
  "workRights": "New Zealand citizen",          // option text for the right-to-work question
  "notice": "None, I'm ready to go now",        // option text for the notice-period question
  "salaryDefault": "$90k",                       // when a job advertises no salary
  "salaryBands": [                               // chosen by the midpoint of the advertised range
    { "upTo": 80000,   "answer": "$75k" },
    { "upTo": 110000,  "answer": "$100k" },
    { "upTo": 9999999, "answer": "$130k" }
  ],
  "salaryHourly": "45"                           // for questions that ask an hourly rate
}
```

Call it with no arguments to read the current settings. Answers are stored in `~/.seek-mcp/answers.json`. An explicit answer in `seek_apply` always wins over a standing one, and a question is never answered twice.

## Actions that need confirmation

Some tools reach other people or cannot be undone. They say so in their descriptions and MCP annotations, and refuse to act without an explicit argument:

- `seek_report_job`, `seek_contact_recruiter` and `seek_company_review_feedback` need `confirm: true`.
- `seek_delete_account` needs `confirmEmail` equal to the signed-in account's email (Seek itself asks for nothing).
- `seek_apply` sends only with `submit: true`; `seek_change_email` changes nothing until the emailed code is given.

A Seek mutation that answers with a typed failure (`…Failure`, `error`, `errors`) is reported as an error, never as done.

## Files and environment

| Path / variable | Purpose |
|---|---|
| `~/.seek-mcp/tokens.json` | The sign-in (mode 600). Delete it, or run `seek_auth` with `logout: true`, to sign the server out. |
| `~/.seek-mcp/answers.json` | Standing answers. |
| `SEEK_TOKEN_DIR` | Directory for the two files above (default `~/.seek-mcp`). |
| `CHROME_PROFILE` | Chrome profile directory name to bootstrap from (default `Default`). |

Nothing about your account is written inside the repository.

## Development

```
src/
  server.ts            createServer(), the core tools (search, job, apply, profile, résumés, saved/applied, auth) and INSTRUCTIONS
  tools/*.ts           the other tools, one module per area: jobs, activity, profile, settings, companies, career, directory
  documents.ts         generated: the GraphQL documents nz.seek.com sends, copied verbatim from its bundles
  seek.ts              constants, signed-out GraphQL (nz.seek.com and the career-guide API), clean(), shared helpers
  auth.ts              token store, renewal, signed-in GraphQL, typed-failure checks, status/check/logout
  api.ts               search, job page fallback, application requirements, profile, saved/applied jobs
  apply.ts             application documents and submit, résumé and attachment uploads, roles, personal details, saved jobs
  jobs.ts              job details over GraphQL, similar jobs, insights, AI job match, reports
  activity.ts          saved searches, notes, applications, priority apply, recommendations and job preferences
  profile-sections.ts  every other profile section, preferences, avatar, résumé download and generation
  settings.ts          notifications, email change, account deletion
  companies.ts         company search, profile, reviews, salaries, jobs, review feedback
  career.ts            career guide, salaries, role reviews, articles
  directory.ts         People search and the recruiter directory
  discover.ts          autocomplete / id lookups, classifications, profile option lists
  answers.ts, cv.ts, chrome-storage.ts, leveldb.ts   standing answers, CV text, Chrome hand-over
test/                  node:test unit tests; scenarios.mjs drives every signed-in operation; fixtures/ holds Seek's schema
scripts/               live checks (below) and research/ (how documents.ts and the schema were produced)
NATIVE-NOTES.md        the Seek API as observed: endpoints, operations, payload shapes, how they were found
```

- `npm test` builds and runs the unit tests. They need no network and no account. `requests-schema.test.mjs` drives every signed-in operation through the real code with canned replies and validates each request's document and variables against Seek's own GraphQL schema.
- `npm run check:public` calls every tool that needs no sign-in against the live site.
- `npm run check:shapes` sends every signed-in request to Seek **without** a sign-in and checks Seek answers `UNAUTHENTICATED` (the request is well formed and nothing ran) rather than `BAD_USER_INPUT`. Operations that might run anonymously, and the application submit, are never sent.
- `npm run smoke` drives the built server against the signed-in account: search, job, requirements, profile and all its sections, preferences, notifications, saved/applied lists, insights, recommendations, and round trips that leave the account as they found it (save → note → clear → unsave, saved search create → alerts off → delete, and a **dry-run** apply). Set `SEEK_CV_PATH` to a résumé file to also exercise `seek_cv_read` and upload → delete. It sends no applications.
- `node scripts/matrix.mjs "<keywords>"` and `node scripts/scan.mjs` dry-run many jobs to see which the standing answers can complete and which questions block the rest.
- `node scripts/submit.mjs <jobId> <hourlyRate> [yes]` **submits a real application** after a dry run; `yes` passes the privacy-policy consent.

To add another Seek operation: rebuild the research catalogue (`scripts/research/`, see NATIVE-NOTES.md), add its name to `scripts/research/gen-documents.mjs`, run `npm run research:documents`, call it with `sgql` (signed in) or `publicGql`, and add a scenario to `test/scenarios.mjs`.

## How it works

- Job search is a GET to Seek's public `jobsearch/v5/search` endpoint. Everything else is GraphQL: `nz.seek.com/graphql` for jobs, companies, the recruiter directory, People search and the account, and `career-guide-api.cloud.seek.com.au/graphql` (with `country: NZ` headers) for the career guide, salaries and articles.
- The documents are the website's own, copied verbatim from its JavaScript bundles: `scripts/research/` downloads each app's bundles, reads the compiled GraphQL ASTs and query strings out of them as data (never running them), and `gen-documents.mjs` writes the ones the server uses into `src/documents.ts`.
- Account calls send a bearer token and Seek's brand/country headers. On `UNAUTHENTICATED` the server renews once and retries. Mutations that answer with a typed failure are reported as errors.
- Applying mirrors the website step for step: `TrackJobApplicationStarted`, `GetJobApplicationProcess` for the questionnaire, `generateCoverLetter` / `generateSelectionCriteria` for written documents (or the presigned upload plus `processUploadedAttachment` for files), then one `submitApplication` whose input is built exactly as the site's bundle builds it (optional parts omitted, not nulled).
- Sign-in renewal is the standard refresh grant against Seek's identity provider; the refresh token rotates on every use, which is why only one party may hold it.

Details, field names and the captured operation list are in [NATIVE-NOTES.md](NATIVE-NOTES.md).

## License

[ISC](LICENSE)
