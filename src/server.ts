#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SeekBrowser, job, search } from "./seek.js";

const browser = new SeekBrowser();
const server = new McpServer({ name: "seek", version: "0.1.0" });

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
});

server.registerTool(
  "seek_search",
  {
    description:
      "Search job ads on Seek NZ (nz.seek.com). Returns id, title, company, location, salary, work type, " +
      "arrangement, listing date and teaser for each job; use seek_job with an id for the full ad.",
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
  async (args) => {
    try {
      return ok(await browser.run((page) => search(page, args)));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "seek_job",
  {
    description: "Full Seek job ad by id: description text, company, location, salary, work type, dates and status.",
    inputSchema: { id: z.string().describe('Seek job id, e.g. "94867040"') },
  },
  async ({ id }) => {
    try {
      return ok(await browser.run((page) => job(page, id.trim())));
    } catch (e) {
      return fail(e);
    }
  },
);

// seek_saved_jobs / seek_applied_jobs (savedJobs, appliedJobs in seek.ts) stay unregistered until a fresh
// profile can complete Seek's login: copied Chrome cookies alone still land on login.seek.com.

const shutdown = async () => {
  await browser.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
