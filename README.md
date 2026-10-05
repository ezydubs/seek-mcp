# seek-mcp

An [MCP](https://modelcontextprotocol.io) server for **Seek New Zealand** (nz.seek.com). It lets an MCP client such as Claude Code or Claude Desktop search jobs, read full ads, inspect what an application requires, manage the signed-in profile and résumés, save jobs, and submit applications.

Everything runs over Seek's own HTTP API with plain Node `fetch`. There is no browser, no Puppeteer and no Playwright at runtime: the search and job-ad endpoints are called directly, and the account features use the same GraphQL operations the Seek website itself sends. The operations and input shapes were captured from the site's network traffic and apply bundle; they are documented in [NATIVE-NOTES.md](NATIVE-NOTES.md).

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
- [Files and environment](#files-and-environment)
- [Development](#development)
- [How it works](#how-it-works)
- [License](#license)

## Features

- **Search and read without signing in** — keyword, location, work type, date range and salary filters; full ad text pulled out of the server-rendered job page.
- **Apply natively** — the same `submitApplication` mutation the website sends, with résumé, written cover letter, written selection criteria, the profile's most recent role and every employer question answered by exact option id. Dry-run mode prepares everything and sends nothing.
- **Answer employer questions deliberately** — human-readable answers are matched against the live questionnaire and must resolve to exactly one option; anything unmatched, ambiguous or duplicated is an error rather than a guess. Standing answers fill the standard work-rights, notice-period and salary questions.
- **Profile management** — read the profile, update name/phone/location, add or edit career-history roles, upload/delete/set-default résumés (with Seek's virus scan awaited), read a local CV as text.
- **Saved and applied jobs** — list them, save and unsave, and see whether a job is already applied to before applying.
- **Self-renewing sign-in** — a one-time hand-over from your own Chrome profile, then automatic renewal; tokens live in a mode-600 file outside the repo.

## Requirements

- **Node.js 22.13 or newer** (uses the built-in `fetch`, `FormData`, `Blob` and `node:test`).
- **macOS** for the one-time Chrome sign-in hand-over (`seek_auth` with `bootstrap`). Everything else is platform-independent.
- **Google Chrome** signed in to nz.seek.com, for that same hand-over.
- Optional: `pdftotext` (from poppler, `brew install poppler`) for `seek_cv_read` on PDFs; `unzip` for DOCX files.

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

`seek_search`, `seek_job` and `seek_cv_read` work without an account. Every other tool needs Seek's sign-in.

1. Sign in to nz.seek.com in Google Chrome (the `Default` profile unless `CHROME_PROFILE` says otherwise).
2. Ask the client to run `seek_auth` with `bootstrap: true`. The server copies Seek's sign-in out of that Chrome profile once, renews it, and stores the result in `~/.seek-mcp/tokens.json` with mode 600.
3. From then on the server renews the sign-in by itself. `seek_auth` with no arguments reports whether a usable sign-in is held and when it expires.

Two things to know:

- Seek rotates the sign-in on every renewal, so the copy Chrome held becomes stale after the hand-over and **Chrome will usually ask you to sign in again**. That is expected. Do not run the bootstrap again unless `seek_auth` reports the server signed out, or you deliberately want the server to take over whichever account Chrome is on now.
- The server acts as **whichever account Chrome was signed into at bootstrap time**. If you have more than one Seek account, check `seek_profile` (it returns the account email) before applying to anything.

There is no username/password sign-in: Seek's identity provider does not allow it for this client, so a real browser login has to exist first.

## Tools

| Tool | Sign-in | What it does |
|---|---|---|
| `seek_search` | no | Search ads. Args: `keywords`, `where` (e.g. `"All Auckland"`), `page`, `pageSize` (≤100), `sort` (`relevance`/`newest`), `workType[]` (`full_time`/`part_time`/`contract`/`casual`), `listedWithinDays` (1/3/7/14/31), `salaryMin`/`salaryMax`/`salaryType`. Flags paid placements with `promoted: true`. |
| `seek_job` | no | Full ad by id: description text, company, location, salary, work type, dates, status, and `externalApply` (true when the employer takes applications off Seek). |
| `seek_cv_read` | no | Text of a local PDF, DOCX or text CV. Extraction only; it does not try to parse names, roles or dates. |
| `seek_auth` | — | Status, or with `bootstrap: true` the one-time Chrome hand-over. |
| `seek_profile` | yes | Account id and email, name, phone, location, résumés (with `isDefault`) and confirmed career-history roles. |
| `seek_profile_update` | yes | Set first/last name, phone (`countryCallingCodeId`, NZ = `"159"`) and optionally `locationId` (Seek location id, e.g. 30010 = Auckland CBD). |
| `seek_add_role` | yes | Add a career-history role, or pass an existing `id` to update it. |
| `seek_resume_upload` | yes | Upload a PDF/DOC/DOCX/TXT/RTF résumé, wait for Seek's virus scan, optionally make it the default (default true). |
| `seek_resume_delete` | yes | Delete a résumé by id. |
| `seek_resume_set_default` | yes | Make a résumé the one applications attach by default. |
| `seek_saved_jobs` | yes | The saved-jobs list. |
| `seek_save_job` / `seek_unsave_job` | yes | Save or unsave a job by id. |
| `seek_applied_jobs` | yes | Applications with dates, whether a résumé/cover letter was included, and status history. |
| `seek_apply_requirements` | yes | What applying needs: `externalApply`, `alreadyApplied`, `saved`, `selectionCriteriaRequired`, and every employer question with its kind, text and exact options. |
| `seek_standing_answers` | — | Read or set the standing answers (see below). |
| `seek_apply` | yes | Prepare (`submit: false`) or send (`submit: true`) an application. See [Applying safely](#applying-safely). |

### `seek_apply` arguments

| Argument | Meaning |
|---|---|
| `id` | Seek job id (numeric string). |
| `submit` | **Required.** `false` prepares and sends nothing; `true` submits the application for real. |
| `answers[]` | One entry per employer question: `{ question, option }` for choice questions (`option` is the option's text, or an array for multiple-choice), `{ question, text }` for free-text questions. `question` is any fragment of the question text; it must match exactly one question, and `option` exactly one option. |
| `coverLetterText` | Full cover letter, sent as a written cover letter. Omit for none. |
| `selectionCriteriaText` | Written selection criteria; required when `seek_apply_requirements` reports `selectionCriteriaRequired`. |
| `resumeId` | Defaults to the profile's default résumé; `null` sends no résumé. |
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

## Files and environment

| Path / variable | Purpose |
|---|---|
| `~/.seek-mcp/tokens.json` | The sign-in (mode 600). Delete it to sign the server out. |
| `~/.seek-mcp/answers.json` | Standing answers. |
| `SEEK_TOKEN_DIR` | Directory for the two files above (default `~/.seek-mcp`). |
| `CHROME_PROFILE` | Chrome profile directory name to bootstrap from (default `Default`). |

Nothing about your account is written inside the repository.

## Development

```
src/
  server.ts          MCP tool definitions and the apply orchestration
  api.ts             search, job ad, application requirements, profile, saved/applied jobs
  apply.ts           mutations: profile, roles, résumés, saved jobs, documents, submit
  answers.ts         standing answers and salary-band logic
  auth.ts            token store, renewal, authenticated GraphQL
  cv.ts              local CV text extraction
  chrome-storage.ts  reads one origin's localStorage from a Chrome profile
  leveldb.ts         dependency-free LevelDB/Snappy reader used by chrome-storage.ts
test/                node:test unit tests (payload shape, answer resolution, token renewal)
scripts/             live checks against a real account (see below)
NATIVE-NOTES.md      the Seek API as observed: endpoints, GraphQL operations, payload shapes
```

- `npm test` builds and runs the unit tests. They need no network and no account.
- `npm run smoke` drives the built server over MCP stdio against the signed-in account: search, job, requirements, profile, saved/applied lists, save→unsave, and a **dry-run** apply. Set `SEEK_CV_PATH` to a résumé file to also exercise `seek_cv_read` and upload→delete. It sends no applications.
- `node scripts/matrix.mjs "<keywords>"` and `node scripts/scan.mjs` dry-run many jobs to see which the standing answers can complete and which questions block the rest.
- `node scripts/submit.mjs <jobId> <hourlyRate> [yes]` **submits a real application** after a dry run; `yes` passes the privacy-policy consent.

To extend the server with another Seek operation, capture it from the website (introspection is disabled) and add it following the pattern in `apply.ts`; record what you learn in `NATIVE-NOTES.md`.

## How it works

- Search is a GET to Seek's public `jobsearch/v5/search` endpoint; a job ad is the `window.SEEK_APOLLO_DATA` object embedded in the job page, extracted with a string-aware brace scanner.
- Account features POST Apollo-style batches to `nz.seek.com/graphql` with a bearer token and Seek's brand/country headers. On `UNAUTHENTICATED` the server renews once and retries.
- Applying mirrors the website step for step: `TrackJobApplicationStarted`, `GetJobApplicationProcess` for the questionnaire, `generateCoverLetter` / `generateSelectionCriteria` for written documents, then one `submitApplication` whose input is built exactly as the site's bundle builds it (optional parts omitted, not nulled). Résumé upload uses the same presigned S3 form the site requests.
- Sign-in renewal is the standard refresh grant against Seek's identity provider; the refresh token rotates on every use, which is why only one party may hold it.

Details, field names and the captured operation list are in [NATIVE-NOTES.md](NATIVE-NOTES.md).

## License

[ISC](LICENSE)
