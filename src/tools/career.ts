import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  careerArticle, careerRole, careerRoleReviews, careerRolesByClassification, careerRoleSuggest, careerSalary, careerSearch,
} from "../career.js";
import { guard } from "../result.js";

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const role = z.string().describe('A career-guide role alias ("accountant"), its URL, or a role title to look up');

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
        "Seek's career guide for a role, localised to New Zealand: what it's like, tasks and duties, skills employers ask " +
        "for, how to become one, typical salary, satisfaction and work-hours stats from people in the role, job growth and " +
        "similar roles. No sign-in.",
      inputSchema: { role },
      annotations: READ,
    },
    ({ role: r }) => guard(() => careerRole(r)),
  );

  server.registerTool(
    "seek_career_salary",
    {
      description:
        "Salary insight for a role: New Zealand-wide or for a region (place names as in job search, e.g. \"All Auckland\", " +
        "\"Canterbury\"), annual or hourly, with average salaries by industry. From Seek's job ads. No sign-in.",
      inputSchema: {
        role,
        region: z.string().optional(),
        type: z.enum(["annual", "hourly"]).optional(),
      },
      annotations: READ,
    },
    ({ role: r, region, type }) => guard(() => careerSalary(r, { region, type })),
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
        "Explore careers by job classification. With no classification, lists them; with one (name, id or URL segment), " +
        "lists its roles with satisfaction, growth and salary. No sign-in.",
      inputSchema: { classification: z.string().optional().describe('e.g. "Accounting", "healthcare-medical", "1200"') },
      annotations: READ,
    },
    ({ classification }) => guard(() => careerRolesByClassification(classification)),
  );

  server.registerTool(
    "seek_career_article",
    {
      description: "Read a Seek career-advice article by alias or URL, or with none list the latest articles. No sign-in.",
      inputSchema: {
        alias: z.string().optional().describe('e.g. "how-to-write-a-cover-letter"'),
        size: z.number().int().min(1).max(30).optional(),
        from: z.number().int().min(0).optional(),
      },
      annotations: READ,
    },
    ({ alias, size, from }) => guard(() => careerArticle(alias, { size, from })),
  );
}
