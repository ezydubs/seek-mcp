#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { authStatus, bootstrapFromChrome, checkSignIn, logout } from "./auth.js";
import { applicationProcess, appliedJobs, job, profile, savedJobs, search } from "./api.js";
import {
  deleteResume, fillStandingAnswers, prepareApplication, resolveAnswers, saveJob, setDefaultResume, submitApplication,
  unsaveJob, updatePersonalDetails, uploadResume, upsertRole,
} from "./apply.js";
import { ANSWERS_PATH, readAnswers, writeAnswers } from "./answers.js";
import { readCv } from "./cv.js";
import { jobDetails } from "./jobs.js";
import { priorityApplyCredit } from "./activity.js";
import { PROFILE_SECTIONS, profileSections } from "./profile-sections.js";
import { fail, guard, ok } from "./result.js";
import { searchFilterShape, toSearchParams } from "./tools/search-shape.js";
import { register as registerJobs } from "./tools/jobs.js";
import { register as registerActivity } from "./tools/activity.js";
import { register as registerProfile } from "./tools/profile.js";
import { register as registerSettings } from "./tools/settings.js";
import { register as registerCompanies } from "./tools/companies.js";
import { register as registerCareer } from "./tools/career.js";
import { register as registerDirectory } from "./tools/directory.js";
import { register as registerFeed } from "./tools/feed.js";

export const VERSION = "0.5.0";

export const INSTRUCTIONS = [
  "Seek New Zealand (nz.seek.com) over Seek's own HTTP API.",
  "No sign-in: seek_search, seek_job, seek_similar_jobs, seek_suggest, seek_classifications, the company tools " +
    "(seek_company_search, seek_company, seek_company_reviews, seek_company_salaries, seek_company_jobs), the career-advice " +
    "tools (seek_career_*, except the Career Compass quiz's recommendations and the reason, hide and unhide actions), the " +
    "recruiter directory (seek_recruiter_search, seek_recruiter), People search and seek_cv_read.",
  "Signed in (seek_auth; check: true confirms it works): the profile and every section of it, résumés, saved jobs, saved " +
    "searches, applied jobs, notes, recommendations, the home feed (seek_home_feed, seek_refine_recommendations, " +
    "seek_home_nudges), notifications, account settings, recording a call to a recruiter, and applying.",
  "seek_job_insights' request flags (requestAiMatch, requestStrongFit, requestStandOut) spend the account's limited AI " +
    "allowances; set them only when the user asks.",
  "Applying: seek_apply_requirements, then seek_apply with submit: false to dry-run, then submit: true. Applications are " +
    "real and cannot be withdrawn; never guess an answer for the user.",
  "Ids: seek_suggest returns the location ids and ontology ids the profile tools take; seek_classifications the " +
    "classification, availability, work-type and visibility ids.",
  "Actions that reach other people or cannot be undone ask for confirm: true (reports, recruiter messages, review " +
    "feedback) or the account email (seek_delete_account). Only take them when the user asked.",
  "Results are JSON; long ones are cut with a note saying how to page.",
].join("\n");

export function createServer() {
  const server = new McpServer({ name: "seek", version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "seek_search",
    {
      description:
        "Search job ads on Seek NZ (nz.seek.com). Filters: keywords, where, work type, work arrangement (on-site, hybrid, " +
        "remote), classification and subclassification ids (seek_classifications), listing date, salary, one advertiser or " +
        "one company. Returns id, title, company, location, salary, work type, arrangement, listing date, teaser and tags " +
        "for each job, plus counts by work type and arrangement; use seek_job with an id for the full ad. Leading rows may " +
        "be paid placements (promoted: true).",
      inputSchema: {
        ...searchFilterShape,
        page: z.number().int().min(1).optional().describe("Results page, default 1"),
        pageSize: z.number().int().min(1).max(100).optional().describe("Results per page, default 20"),
        sort: z.enum(["relevance", "newest"]).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => guard(() => search(toSearchParams(args))),
  );

  server.registerTool(
    "seek_job",
    {
      description:
        "Full Seek job ad by id: description, company, advertiser (and how long it has been on Seek), location, salary, " +
        "work type and arrangement, classification, dates, status, bullet points, badges, the employer's screening " +
        "questions, contact details in the ad, the company profile summary (rating, size, perks) and whether the " +
        "application happens off-site (externalApply). Signed in, it adds the applicant count and the salary match.",
      inputSchema: { id: z.string().describe('Seek job id, e.g. "94867040"') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ id }) =>
      guard(async () => {
        const jobId = id.trim();
        try {
          const d = await jobDetails(jobId);
          if (d) return d;
        } catch (e) {
          if (/numeric/.test((e as Error).message)) throw e;
        }
        return job(jobId);
      }),
  );

  server.registerTool(
    "seek_apply_requirements",
    {
      description:
        "What applying to a job requires, before applying: whether it is off-site (externalApply), whether the " +
        "user has already applied (alreadyApplied) or saved it (saved), whether written selection criteria are " +
        "mandatory (selectionCriteriaRequired), and every employer question with its exact option ids. Use this " +
        "before writing a cover letter or choosing answers — option ids are what an application submits. It also " +
        "lists verificationNudges: Seek's prompts to verify an identity or credential for this job, with the link.",
      inputSchema: { id: z.string().describe('Seek job id, e.g. "94867040"') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ id }) => guard(() => applicationProcess(id.trim(), { verificationNudges: true })),
  );

  server.registerTool(
    "seek_profile",
    {
      description:
        "The signed-in Seek profile: id, email, name, phone, location, career history and uploaded résumés " +
        "(isDefault marks the one applications attach unless resumeId is given). Check this before applying — " +
        "Seek sends the profile with every application. sections adds more of the profile: " +
        `${PROFILE_SECTIONS.join(", ")}, or "all".`,
      inputSchema: {
        sections: z.array(z.enum([...PROFILE_SECTIONS, "all"] as [string, ...string[]])).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ sections }) =>
      guard(async () => (sections?.length ? { ...(await profile()), ...(await profileSections(sections)) } : profile())),
  );

  server.registerTool(
    "seek_saved_jobs",
    {
      description: "The user's saved jobs on Seek (signed in as them), with any notes (seek_job_note).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => guard(() => savedJobs()),
  );

  server.registerTool(
    "seek_applied_jobs",
    {
      description:
        "Jobs the user has applied for on Seek, with application dates, whether a résumé/cover letter was " +
        "included, status history and notes, and for each application on Seek the number of candidates who applied " +
        "(applicants) and the share who attached a résumé and a cover letter (off-site applications have none). " +
        "applicants: false skips those figures for a quicker list. seek_application has the documents sent.",
      inputSchema: {
        applicants: z.boolean().optional().describe("Include each job's applicant count and résumé/cover-letter shares (default true)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ applicants }) => guard(() => appliedJobs({ applicants })),
  );

  server.registerTool(
    "seek_cv_read",
    {
      description:
        "Read a CV/résumé from a local file (PDF, DOCX or text) and return its text. Use this before " +
        "seek_profile_update or writing a cover letter. Only the text is extracted — deciding what is a " +
        "name, role or date is left to the caller, since CV layouts differ too much to parse reliably.",
      inputSchema: { path: z.string().describe('Absolute path, e.g. "/Users/you/Downloads/CV.pdf"') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ path }) => guard(() => readCv(path)),
  );

  server.registerTool(
    "seek_profile_update",
    {
      description:
        "Change the Seek profile's name and phone, and optionally its location. Seek sends the profile with every " +
        "application, so placeholder details make applications unattributable. Does not touch the account email " +
        "(seek_change_email does). locationId is a Seek location id, not a place name (seek_suggest kind " +
        "profile_locations finds it; 30010 = Auckland CBD); omit it to keep the current location.",
      inputSchema: {
        firstName: z.string(),
        lastName: z.string(),
        phoneNumber: z.string().describe("Digits only, no + or spaces"),
        countryCallingCodeId: z.string().optional().describe('Seek dialling-code id; New Zealand is "159"'),
        locationId: z.number().int().optional().describe("Seek location id; omit to leave the location unchanged"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => guard(() => updatePersonalDetails(args)),
  );

  server.registerTool(
    "seek_add_role",
    {
      description:
        "Add a role to the Seek profile's career history (months are 1-12). Pass an existing id to update " +
        "a role instead of adding one. seek_role_manage deletes roles.",
      inputSchema: {
        title: z.string(),
        company: z.string(),
        fromYear: z.number().int(),
        fromMonth: z.number().int().min(1).max(12),
        toYear: z.number().int().optional().describe("omit for a current role"),
        toMonth: z.number().int().min(1).max(12).optional(),
        achievements: z.string().optional().describe("Description bullets"),
        id: z.string().optional().describe("Existing role id, to update rather than add"),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ id, title, company, fromYear, fromMonth, toYear, toMonth, achievements }) =>
      guard(() =>
        upsertRole({
          id,
          title,
          company,
          from: { year: fromYear, month: fromMonth },
          to: toYear && toMonth ? { year: toYear, month: toMonth } : null,
          achievements,
        }),
      ),
  );

  server.registerTool(
    "seek_standing_answers",
    {
      description:
        "View or set the standing answers used to fill Seek's standard screening questions (work rights, " +
        "expected salary, notice period) so applications can go out unattended. Salary is answered from " +
        "the band matching each job's advertised range, falling back to defaultAnswer when no salary is " +
        "stated. Omit all arguments to read the current settings.",
      inputSchema: {
        workRights: z.string().optional().describe('Option text for the right-to-work question, e.g. "New Zealand citizen"'),
        notice: z.string().optional().describe('Option text for the notice-period question, e.g. "ready to go now"'),
        salaryDefault: z.string().optional().describe('Used when a job states no salary, e.g. "$90k"'),
        salaryBands: z
          .array(z.object({ upTo: z.number().int(), answer: z.string() }))
          .optional()
          .describe('Bands keyed by the top of the advertised range, e.g. [{upTo:65000,answer:"$65k"}]'),
        salaryHourly: z.string().optional().describe('Figure for questions asking an hourly rate, e.g. "45"'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ workRights, notice, salaryDefault, salaryBands, salaryHourly }) =>
      guard(async () => {
        if (!workRights && !notice && !salaryDefault && !salaryBands && !salaryHourly)
          return { path: ANSWERS_PATH, answers: readAnswers() };
        const cur = readAnswers();
        const next = {
          ...cur,
          workRights: workRights ? { question: "right to work", option: workRights } : cur.workRights,
          notice: notice ? { question: "notice", option: notice } : cur.notice,
          salary: salaryDefault || salaryBands || salaryHourly
            ? {
                question: "expected annual base salary",
                bands: salaryBands ?? cur.salary?.bands ?? [],
                defaultAnswer: salaryDefault ?? cur.salary?.defaultAnswer ?? "",
                hourlyAnswer: salaryHourly ?? cur.salary?.hourlyAnswer,
              }
            : cur.salary,
        };
        const path = writeAnswers(next);
        return { path, answers: next };
      }),
  );

  const answersSchema = z.array(
    z.object({
      question: z.string().describe('Text from the question, e.g. "right to work"'),
      option: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe('Chosen option text, e.g. "$60k"; an array for multiple-choice questions'),
      text: z.string().optional().describe("The answer to a free-text question, sent as written"),
    }),
  );

  server.registerTool(
    "seek_apply",
    {
      description:
        "Apply to a job. Reads the live questionnaire with seek_apply_requirements first, maps the given " +
        "answers onto exact option ids (erroring rather than guessing if one is missing or ambiguous), " +
        "then either prepares the application or sends it. Get the cover letter text from the job " +
        "description via seek_job and the candidate's CV via seek_cv_read; or attach a cover letter file with " +
        "coverLetterPath. Refuses jobs the user has already applied to and off-site (externalApply) jobs " +
        "(seek_apply_external records those). strongInterest spends a priority-apply credit to flag the " +
        "application (see seek_application action credits). " +
        "submit=false stops after preparing, which changes nothing an employer can see. " +
        "submit=true sends a real application immediately, and Seek offers no way to withdraw it.",
      inputSchema: {
        id: z.string().describe("Seek job id"),
        coverLetterText: z.string().optional().describe("The full cover letter; omit for none"),
        coverLetterPath: z.string().optional().describe("A cover letter file (PDF, DOC, DOCX, TXT, RTF) to attach instead of text"),
        selectionCriteriaText: z
          .string()
          .optional()
          .describe("Written response to the selection criteria; required when seek_apply_requirements says selectionCriteriaRequired"),
        selectionCriteriaPath: z.string().optional().describe("A selection-criteria file to attach instead of text"),
        answers: answersSchema.optional().describe("One entry per question the job asks"),
        resumeId: z.string().nullable().optional().describe("Defaults to the profile's default résumé; null for none"),
        strongInterest: z.boolean().optional().describe("Spend a priority-apply credit to flag strong interest"),
        submit: z.boolean().describe("true sends the application for real. Required."),
        profilePrivacyLevel: z.enum(["Public", "Private"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (a) => {
      try {
        const jobId = a.id.trim();
        if (!/^\d+$/.test(jobId)) throw new Error(`Seek job ids are numeric; got "${jobId}"`);
        const process = await applicationProcess(jobId);
        if (process.externalApply) {
          return ok({
            jobId,
            externalApply: true,
            submitted: false,
            detail: "This advertiser takes applications off Seek. Nothing was sent; seek_apply_external records it and gives the employer's address.",
            applyUrl: process.applyPath,
          });
        }
        if (process.alreadyApplied) {
          return ok({
            jobId,
            alreadyApplied: true,
            submitted: false,
            detail: "The user has already applied to this job on Seek (see seek_applied_jobs). Nothing was sent.",
          });
        }
        if (process.selectionCriteriaRequired && !a.selectionCriteriaText?.trim() && !a.selectionCriteriaPath) {
          throw new Error(
            "This job requires written selection criteria: pass selectionCriteriaText or selectionCriteriaPath (see seek_apply_requirements).",
          );
        }

        const standing = readAnswers();
        let wanted = [...(a.answers ?? [])];
        let autoFilled: Array<{ question: string; answer: string; basis: string }> = [];
        if (process.questions.length) {
          const ad = await jobDetails(jobId).then((j: any) => j?.salary ?? null).catch(() => job(jobId).then((j) => j.salary).catch(() => null));
          ({ wanted, autoFilled } = fillStandingAnswers(process.questions, wanted, standing, ad));
        }

        const questionnaireAnswers = process.questions.length ? await resolveAnswers(process, wanted) : [];
        const profile_ = await profile();
        const defaultResume = profile_.resumes.find((r: { isDefault?: boolean }) => r.isDefault) ?? profile_.resumes[0];
        const resume = a.resumeId === null ? null : a.resumeId ?? defaultResume?.id ?? null;

        const newest = profile_.roles[0];
        const mostRecentRole =
          newest?.title && newest?.company && newest?.from
            ? {
                company: newest.company,
                title: newest.title,
                started: { year: newest.from.year, month: newest.from.month },
                finished: newest.to ? { year: newest.to.year, month: newest.to.month } : null,
              }
            : null;

        const priorityApply = a.strongInterest
          ? (((await priorityApplyCredit()) as { state?: "Prioritized" | "Pending" }).state ?? "Pending")
          : null;
        const input = {
          jobId,
          resumeId: resume,
          coverLetterText: a.coverLetterText,
          coverLetterPath: a.coverLetterPath,
          selectionCriteriaText: a.selectionCriteriaText,
          selectionCriteriaPath: a.selectionCriteriaPath,
          questionnaireAnswers,
          mostRecentRole,
          profilePrivacyLevel: a.profilePrivacyLevel,
          priorityApply,
        };

        if (!a.submit) {
          const pre = await prepareApplication(input);
          return ok({
            jobId,
            submitted: false,
            detail: "Prepared only. Nothing was sent to the employer.",
            resume: pre.resume,
            coverLetterPrepared: !!pre.coverLetterUri,
            selectionCriteriaPrepared: !!pre.selectionCriteriaUri,
            strongInterest: priorityApply ?? undefined,
            mostRecentRole,
            autoFilled,
            answers: questionnaireAnswers.map((x) => ({ questionId: x.questionId, chosen: x.answers.map((y) => y.text) })),
          });
        }

        const result = await submitApplication(input);
        return ok({ jobId, submitted: true, strongInterest: priorityApply ?? undefined, ...result });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "seek_resume_upload",
    {
      description:
        "Upload a résumé (PDF, DOC, DOCX, TXT or RTF) to the Seek profile and wait for Seek's virus scan so it can " +
        "be attached to applications. It becomes the default résumé unless makeDefault is false. Returns the new " +
        "résumé's id and the full list.",
      inputSchema: {
        path: z.string().describe('Absolute path to the file, e.g. "/Users/you/Documents/CV.pdf"'),
        makeDefault: z.boolean().optional().describe("Attach this résumé to applications from now on (default true)"),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ path, makeDefault }) => guard(() => uploadResume(path, { makeDefault })),
  );

  server.registerTool(
    "seek_resume_delete",
    {
      description: "Delete a résumé from the Seek profile. Ids come from seek_profile. Cannot be undone.",
      inputSchema: { id: z.string().describe("Résumé id (a UUID)") },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    ({ id }) => guard(() => deleteResume(id.trim())),
  );

  server.registerTool(
    "seek_resume_set_default",
    {
      description: "Make one of the profile's résumés the default, i.e. the one applications attach when no resumeId is given.",
      inputSchema: { id: z.string().describe("Résumé id (a UUID)") },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ id }) => guard(() => setDefaultResume(id.trim())),
  );

  server.registerTool(
    "seek_save_job",
    {
      description: "Save a job to the user's saved jobs on Seek (the list seek_saved_jobs returns).",
      inputSchema: { id: z.string().describe("Seek job id") },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ id }) => guard(() => saveJob(id.trim())),
  );

  server.registerTool(
    "seek_unsave_job",
    {
      description: "Remove a job from the user's saved jobs on Seek.",
      inputSchema: { id: z.string().describe("Seek job id") },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ id }) => guard(() => unsaveJob(id.trim())),
  );

  server.registerTool(
    "seek_auth",
    {
      description:
        "Check or establish the Seek sign-in. With no arguments, reports whether a usable sign-in is held, when it " +
        "expires, and whether Seek last refused to renew it. check: true also asks Seek which account it belongs to. " +
        "bootstrap: true takes Seek's sign-in out of the user's Chrome profile once and renews it; the server then " +
        "keeps its own copy and Chrome may need a fresh sign-in. logout: true revokes the server's sign-in and deletes it.",
      inputSchema: {
        bootstrap: z.boolean().optional().describe("Take the sign-in from Chrome now"),
        check: z.boolean().optional().describe("Confirm with Seek that the sign-in works"),
        logout: z.boolean().optional().describe("Revoke and delete the server's sign-in"),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ bootstrap, check, logout: out }) =>
      guard(async () => {
        if (out) return logout();
        if (bootstrap) return { ...(await bootstrapFromChrome()), status: authStatus() };
        if (check) {
          try {
            return { ...authStatus(), ...(await checkSignIn()) };
          } catch (e) {
            return { ...authStatus(), working: false, error: (e as Error).message };
          }
        }
        return authStatus();
      }),
  );

  registerJobs(server);
  registerActivity(server);
  registerProfile(server);
  registerSettings(server);
  registerCompanies(server);
  registerCareer(server);
  registerDirectory(server);
  registerFeed(server);
  return server;
}

const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  const shutdown = () => process.exit(0);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
  await createServer().connect(new StdioServerTransport());
}
