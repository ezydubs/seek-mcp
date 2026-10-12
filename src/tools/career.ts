import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  careerArticle, careerHideRecommendation, careerPathways, careerQuiz, careerRole, careerRoleCounts, careerRoleJobs, careerRoleReason,
  careerRoleReviews, careerRolesByClassification, careerRolesBySkills, careerRoleSuggest, careerSalary, careerSearch,
} from "../career.js";
import { guard } from "../result.js";

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const role = z.string().describe('A career-guide role alias ("accountant"), its URL, or a role title to look up');
const region = z
  .string()
  .optional()
  .describe('A place as job search takes it, e.g. "All Auckland", "All Canterbury" (a bare region name means its main centre); default all of New Zealand');

export function register(server: McpServer) {
  server.registerTool(
    "seek_career_search",
    {
      description:
        "Search Seek's career advice: roles in the career guide (with typical salary, job satisfaction and growth) and " +
        "advice articles. type roles, articles or all (default). suggest: true returns quick role-title completions. No sign-in.",
      inputSchema: {
        term: z.string(),
        type: z.enum(["roles", "articles", "all"]).optional(),
        suggest: z.boolean().optional(),
        size: z.number().int().min(1).max(50).optional(),
        from: z.number().int().min(0).optional().describe("Offset for paging"),
      },
      annotations: READ,
    },
    ({ term, type, suggest, size, from }) => guard(() => (suggest ? careerRoleSuggest(term, size) : careerSearch({ term, type, size, from }))),
  );

  server.registerTool(
    "seek_career_role",
    {
      description:
        "Seek's career guide for a role, localised to New Zealand. section guide (default): what it's like, tasks and duties, " +
        "skills employers ask for (with ids seek_career_explore takes), how to become one, typical salary, satisfaction and " +
        "work-hours stats from people in the role, job growth, similar roles and how many Seek jobs are open now (region " +
        "narrows the count). pathways: roles people move on to, with their starting salary and open jobs; differentField " +
        "for moves into other fields, min/maxSalaryLiftPercent for a pay rise or cut. jobs: the latest Seek jobs for the " +
        "role in the region. reason: why Seek's Career Compass recommended the role to this account, with the " +
        "recommendationId seek_career_quiz hides (needs a sign-in). Everything else needs no sign-in.",
      inputSchema: {
        role,
        section: z.enum(["guide", "pathways", "jobs", "reason"]).optional(),
        region,
        size: z.number().int().min(1).max(50).optional().describe("pathways: roles (default 5, up to 20); jobs: jobs (default 10)"),
        differentField: z.boolean().optional().describe("pathways: moves into other fields instead of the same one"),
        minSalaryLiftPercent: z.number().optional().describe("pathways: only roles paying at least this much more, e.g. 20"),
        maxSalaryLiftPercent: z.number().optional().describe("pathways: only roles paying at most this much more; negative for a pay cut"),
      },
      annotations: READ,
    },
    ({ role: r, section, region: where, size, differentField, minSalaryLiftPercent, maxSalaryLiftPercent }) =>
      guard(() => {
        switch (section ?? "guide") {
          case "pathways":
            return careerPathways(r, { size, differentField, minSalaryLiftPercent, maxSalaryLiftPercent, region: where });
          case "jobs":
            return careerRoleJobs(r, { region: where, size });
          case "reason":
            return careerRoleReason(r);
          default:
            return careerRole(r, { region: where });
        }
      }),
  );

  server.registerTool(
    "seek_career_salary",
    {
      description:
        "Salary insight for a role: New Zealand-wide or for a region (place names as in job search, e.g. \"All Auckland\", " +
        "\"All Canterbury\"), annual or hourly, with average salaries by industry. From Seek's job ads. No sign-in.",
      inputSchema: {
        role,
        region: z.string().optional(),
        type: z.enum(["annual", "hourly"]).optional(),
      },
      annotations: READ,
    },
    ({ role: r, region: where, type }) => guard(() => careerSalary(r, { region: where, type })),
  );

  server.registerTool(
    "seek_career_reviews",
    {
      description: "What people working in a role say about it: ratings, the good things, the challenges, pay and progression. No sign-in.",
      inputSchema: {
        role,
        sentiment: z.enum(["positive", "negative"]).optional(),
        from: z.number().int().min(0).optional(),
        size: z.number().int().min(1).max(30).optional(),
      },
      annotations: READ,
    },
    ({ role: r, sentiment, from, size }) => guard(() => careerRoleReviews(r, { sentiment, from, size })),
  );

  server.registerTool(
    "seek_career_explore",
    {
      description:
        "Explore careers. With no arguments, lists the job classifications; with a classification (name, id or URL segment), " +
        "lists its roles with satisfaction, growth and salary. skills: roles that use the given skills, best match first " +
        "(names, ids from seek_career_role's skills, or ontology ids from seek_suggest kind skills). counts: how many " +
        "career-guide roles there are per industry and per interest theme, narrowed by classification, theme, salary, " +
        "satisfaction and growth. No sign-in.",
      inputSchema: {
        classification: z.string().optional().describe('e.g. "Accounting", "healthcare-medical", "1200"'),
        skills: z.array(z.string()).min(1).optional().describe('e.g. ["Xero", "Financial Reporting"]'),
        topSkills: z.number().int().min(1).max(50).optional().describe("skills: only roles listing a given skill among their top N"),
        size: z.number().int().min(1).max(50).optional().describe("skills: roles to return (default 20)"),
        counts: z.boolean().optional(),
        theme: z.string().optional().describe('counts: an interest theme as counts names it, e.g. "Working with numbers"'),
        minSalary: z.number().int().optional().describe("counts: typical salary at least this"),
        maxSalary: z.number().int().optional().describe("counts: typical salary at most this"),
        minSatisfaction: z.number().int().min(1).max(5).optional().describe("counts: job satisfaction at least this (1-5)"),
        minGrowth: z.number().int().optional().describe("counts: projected job growth at least this percent"),
      },
      annotations: READ,
    },
    ({ classification, skills, topSkills, size, counts, theme, minSalary, maxSalary, minSatisfaction, minGrowth }) =>
      guard(() => {
        if (skills?.length) return careerRolesBySkills(skills, { size, topSkills });
        if (counts) return careerRoleCounts({ classification, theme, minSalary, maxSalary, minSatisfaction, minGrowth });
        return careerRolesByClassification(classification);
      }),
  );

  server.registerTool(
    "seek_career_article",
    {
      description:
        "Read a Seek career-advice article by alias or URL. Without one, lists articles: list latest (default), featured " +
        "(the articles Seek features) or popular (a sample of four popular ones, different each call); category lists a " +
        "category's articles (explore-careers, job-hunting and working-life give their featured articles; others such as " +
        "resumes, cover-letters, job-interviews or changing-careers list theirs, paged). No sign-in.",
      inputSchema: {
        alias: z.string().optional().describe('e.g. "how-to-write-a-cover-letter"'),
        list: z.enum(["latest", "featured", "popular"]).optional(),
        category: z.string().optional().describe('A category alias, e.g. "job-hunting", "cover-letters"'),
        size: z.number().int().min(1).max(30).optional(),
        from: z.number().int().min(0).optional(),
      },
      annotations: READ,
    },
    ({ alias, list, category, size, from }) => guard(() => careerArticle(alias, { list, category, size, from })),
  );

  server.registerTool(
    "seek_career_quiz",
    {
      description:
        "Seek's Career Compass quiz, which ends in AI career recommendations with a reason for each. Walk it one step at a " +
        "time: action question (default) returns the step numbered step (default: how many answers are given), with its kind " +
        "and choices; add the answer to answers ({ choices } for multichoice, { text } for freeText, { role } for profile) " +
        "and ask again until kind is recommendations. Every step but the last works without a sign-in; the recommendations " +
        "need one (seek_auth). reason: why a role was recommended to this account; hide / unhide: hide or restore a " +
        "recommendation by its recommendationId. reason, hide and unhide need a sign-in.",
      inputSchema: {
        action: z.enum(["question", "reason", "hide", "unhide"]).optional(),
        step: z.number().int().min(0).optional().describe("question: 0-based step; default the number of answers"),
        answers: z
          .array(
            z.object({
              choices: z.array(z.string()).optional().describe("multichoice: chosen choices, exactly as listed"),
              text: z.string().optional().describe("freeText"),
              role: z.string().optional().describe("profile: current role title"),
            }),
          )
          .optional()
          .describe("question: the answers so far, in step order"),
        role: z.string().optional().describe("reason: a role alias, URL or title"),
        recommendationId: z.string().optional().describe("hide / unhide: from the recommendations or reason"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ action, step, answers, role: r, recommendationId }) =>
      guard(async () => {
        switch (action ?? "question") {
          case "reason":
            if (!r) throw new Error("reason needs role");
            return careerRoleReason(r);
          case "hide":
          case "unhide":
            if (!recommendationId) throw new Error(`${action} needs recommendationId`);
            return careerHideRecommendation(recommendationId, action === "hide");
          default:
            return careerQuiz({ step, answers });
        }
      }),
  );
}
