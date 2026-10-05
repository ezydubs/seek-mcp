#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { authStatus, bootstrapFromChrome, NotLoggedInError } from "./auth.js";
import { applicationProcess, appliedJobs, job, profile, savedJobs, search } from "./api.js";
import {
  deleteResume, fillStandingAnswers, prepareApplication, resolveAnswers, saveJob, setDefaultResume, submitApplication,
  unsaveJob, updatePersonalDetails, uploadResume, upsertRole,
} from "./apply.js";
import { ANSWERS_PATH, readAnswers, writeAnswers } from "./answers.js";
import { readCv } from "./cv.js";

const server = new McpServer({ name: "seek", version: "0.3.0" });

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  const hint =
    e instanceof NotLoggedInError
      ? " (signed-in tools need seek_auth; seek_search and seek_job do not)"
      : "";
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${msg}${hint}` }] };
};

const guard = (fn: () => Promise<unknown>) => fn().then(ok, fail);

server.registerTool(
  "seek_search",
  {
    description:
      "Search job ads on Seek NZ (nz.seek.com). Returns id, title, company, location, salary, work type, " +
      "arrangement, listing date and teaser for each job; use seek_job with an id for the full ad. " +
      "Leading rows may be paid placements (promoted: true).",
    inputSchema: {
      keywords: z.string().optional().describe('What to search for, e.g. "software engineer"'),
      where: z.string().optional().describe('Place, e.g. "All Auckland", "Wellington", "Christchurch"'),
      page: z.number().int().min(1).optional().describe("Results page, default 1"),
      pageSize: z.number().int().min(1).max(100).optional().describe("Results per page, default 20"),
      sort: z.enum(["relevance", "newest"]).optional(),
      workType: z.array(z.enum(["full_time", "part_time", "contract", "casual"])).optional(),
      listedWithinDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(31)]).optional(),
      salaryMin: z.number().int().min(0).optional(),
      salaryMax: z.number().int().min(0).optional(),
      salaryType: z.enum(["annual", "hourly"]).optional().describe("Units for salaryMin/Max, default annual"),
    },
  },
  (args) => guard(() => search(args)),
);

server.registerTool(
  "seek_job",
  {
    description:
      "Full Seek job ad by id: description text, company, location, salary, work type, dates and status, " +
      "and whether the application happens off-site (externalApply).",
    inputSchema: { id: z.string().describe('Seek job id, e.g. "94867040"') },
  },
  ({ id }) => guard(() => job(id.trim())),
);

server.registerTool(
  "seek_apply_requirements",
  {
    description:
      "What applying to a job requires, before applying: whether it is off-site (externalApply), whether the " +
      "user has already applied (alreadyApplied) or saved it (saved), whether written selection criteria are " +
      "mandatory (selectionCriteriaRequired), and every employer question with its exact option ids. Use this " +
      "before writing a cover letter or choosing answers — option ids are what an application submits.",
    inputSchema: { id: z.string().describe('Seek job id, e.g. "94867040"') },
  },
  ({ id }) => guard(() => applicationProcess(id.trim())),
);

server.registerTool(
  "seek_profile",
  {
    description:
      "The signed-in Seek profile: id, email, name, phone, location, career history and uploaded résumés " +
      "(isDefault marks the one applications attach unless resumeId is given). Check this before applying — " +
      "Seek sends the profile with every application.",
    inputSchema: {},
  },
  () => guard(() => profile()),
);

server.registerTool(
  "seek_saved_jobs",
  { description: "The user's saved jobs on Seek (signed in as them)." , inputSchema: {} },
  () => guard(() => savedJobs()),
);

server.registerTool(
  "seek_applied_jobs",
  {
    description:
      "Jobs the user has applied for on Seek, with application dates, whether a résumé/cover letter was " +
      "included, and status history.",
    inputSchema: {},
  },
  () => guard(() => appliedJobs()),
);

server.registerTool(
  "seek_cv_read",
  {
    description:
      "Read a CV/résumé from a local file (PDF, DOCX or text) and return its text. Use this before " +
      "seek_profile_update or writing a cover letter. Only the text is extracted — deciding what is a " +
      "name, role or date is left to the caller, since CV layouts differ too much to parse reliably.",
    inputSchema: { path: z.string().describe('Absolute path, e.g. "/Users/you/Downloads/CV.pdf"') },
  },
  ({ path }) => guard(() => readCv(path)),
);

server.registerTool(
  "seek_profile_update",
  {
    description:
      "Change the Seek profile's name and phone. Seek sends the profile with every application, so " +
      "placeholder details make applications unattributable. Does not touch the account email. " +
      "locationId is a Seek location id, not a place name (30010 = Auckland CBD); omit to leave it.",
    inputSchema: {
      firstName: z.string(),
      lastName: z.string(),
      phoneNumber: z.string().describe("Digits only, no + or spaces"),
      countryCallingCodeId: z.string().optional().describe('Seek dialling-code id; New Zealand is "159"'),
      locationId: z.number().int().optional().describe("Seek location id; omit to leave the location unchanged"),
    },
  },
  (args) => guard(() => updatePersonalDetails(args)),
);

server.registerTool(
  "seek_add_role",
  {
    description:
      "Add a role to the Seek profile's career history (months are 1-12). Pass an existing id to update " +
      "a role instead of adding one.",
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
    text: z.string().optional().describe('The answer to a free-text question, sent as written'),
  }),
);

server.registerTool(
  "seek_apply",
  {
    description:
      "Apply to a job. Reads the live questionnaire with seek_apply_requirements first, maps the given " +
      "answers onto exact option ids (erroring rather than guessing if one is missing or ambiguous), " +
      "then either prepares the application or sends it. Get the cover letter text from the job " +
      "description via seek_job and the candidate's CV via seek_cv_read. Refuses jobs the user has already " +
      "applied to and off-site (externalApply) jobs. " +
      "submit=false stops after preparing, which changes nothing an employer can see. " +
      "submit=true sends a real application immediately, and Seek offers no way to withdraw it.",
    inputSchema: {
      id: z.string().describe("Seek job id"),
      coverLetterText: z.string().optional().describe("The full cover letter; omit for none"),
      selectionCriteriaText: z
        .string()
        .optional()
        .describe("Written response to the selection criteria; required when seek_apply_requirements says selectionCriteriaRequired"),
      answers: answersSchema.optional().describe("One entry per question the job asks"),
      resumeId: z.string().nullable().optional().describe("Defaults to the profile's default résumé; null for none"),
      submit: z.boolean().describe("true sends the application for real. Required."),
      profilePrivacyLevel: z.enum(["Public", "Private"]).optional(),
    },
  },
  async ({ id, coverLetterText, selectionCriteriaText, answers, resumeId, submit, profilePrivacyLevel }) => {
    try {
      const jobId = id.trim();
      if (!/^\d+$/.test(jobId)) throw new Error(`Seek job ids are numeric; got "${jobId}"`);
      const process = await applicationProcess(jobId);
      if (process.externalApply) {
        return ok({
          jobId,
          externalApply: true,
          submitted: false,
          detail: "This advertiser takes applications off Seek. Nothing was sent.",
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
      if (process.selectionCriteriaRequired && !selectionCriteriaText?.trim()) {
        throw new Error("This job requires written selection criteria: pass selectionCriteriaText (see seek_apply_requirements).");
      }

      const standing = readAnswers();
      let wanted = [...(answers ?? [])];
      let autoFilled: Array<{ question: string; answer: string; basis: string }> = [];
      if (process.questions.length) {
        const ad = await job(jobId).then((j) => j.salary).catch(() => null);
        ({ wanted, autoFilled } = fillStandingAnswers(process.questions, wanted, standing, ad));
      }

      const questionnaireAnswers = process.questions.length ? await resolveAnswers(process, wanted) : [];
      const profile_ = await profile();
      const defaultResume = profile_.resumes.find((r: { isDefault?: boolean }) => r.isDefault) ?? profile_.resumes[0];
      const resume = resumeId === null ? null : resumeId ?? defaultResume?.id ?? null;

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

      if (!submit) {
        const pre = await prepareApplication({
          jobId,
          resumeId: resume,
          coverLetterText,
          selectionCriteriaText,
          mostRecentRole,
        });
        return ok({
          jobId,
          submitted: false,
          detail: "Prepared only. Nothing was sent to the employer.",
          resume: pre.resume,
          coverLetterPrepared: !!pre.coverLetterUri,
          selectionCriteriaPrepared: !!pre.selectionCriteriaUri,
          mostRecentRole,
          autoFilled,
          answers: questionnaireAnswers.map((a) => ({ questionId: a.questionId, chosen: a.answers.map((x) => x.text) })),
        });
      }

      const result = await submitApplication({
        jobId,
        resumeId: resume,
        coverLetterText,
        selectionCriteriaText,
        questionnaireAnswers,
        mostRecentRole,
        profilePrivacyLevel,
      });
      return ok({ jobId, submitted: true, ...result });
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
  },
  ({ path, makeDefault }) => guard(() => uploadResume(path, { makeDefault })),
);

server.registerTool(
  "seek_resume_delete",
  {
    description: "Delete a résumé from the Seek profile. Ids come from seek_profile. Cannot be undone.",
    inputSchema: { id: z.string().describe("Résumé id (a UUID)") },
  },
  ({ id }) => guard(() => deleteResume(id.trim())),
);

server.registerTool(
  "seek_resume_set_default",
  {
    description: "Make one of the profile's résumés the default, i.e. the one applications attach when no resumeId is given.",
    inputSchema: { id: z.string().describe("Résumé id (a UUID)") },
  },
  ({ id }) => guard(() => setDefaultResume(id.trim())),
);

server.registerTool(
  "seek_save_job",
  {
    description: "Save a job to the user's saved jobs on Seek (the list seek_saved_jobs returns).",
    inputSchema: { id: z.string().describe("Seek job id") },
  },
  ({ id }) => guard(() => saveJob(id.trim())),
);

server.registerTool(
  "seek_unsave_job",
  {
    description: "Remove a job from the user's saved jobs on Seek.",
    inputSchema: { id: z.string().describe("Seek job id") },
  },
  ({ id }) => guard(() => unsaveJob(id.trim())),
);

server.registerTool(
  "seek_auth",
  {
    description:
      "Check or establish the Seek sign-in. With no action, reports whether a usable token is held and when " +
      "it expires. With bootstrap=true, takes Seek's Auth0 pair out of the user's Chrome profile once and " +
      "renews it; the server then keeps its own copy and Chrome may need a fresh sign-in.",
    inputSchema: { bootstrap: z.boolean().optional().describe("Take the sign-in from Chrome now") },
  },
  ({ bootstrap }) =>
    guard(async () => (bootstrap ? { ...(await bootstrapFromChrome()), status: authStatus() } : authStatus())),
);

const shutdown = () => process.exit(0);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
