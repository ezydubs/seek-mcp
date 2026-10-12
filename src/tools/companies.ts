import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  REVIEW_FLAG_REASONS, company, companyJobs, companyReviewLocations, companyReviews, companySalaries, searchCompanies,
  voteOrFlagReview,
} from "../companies.js";
import { guard } from "../result.js";

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const companyRef = z.string().describe('Company id, slug or profile URL ("kiwibank-171714208688486"), or a name to look up');

export function register(server: McpServer) {
  server.registerTool(
    "seek_company_search",
    {
      description: "Find company profiles on Seek by name, with their ids, review counts and ratings. No sign-in.",
      inputSchema: { name: z.string(), limit: z.number().int().min(1).max(30).optional() },
      annotations: READ,
    },
    ({ name, limit }) => guard(() => searchCompanies(name, limit)),
  );

  server.registerTool(
    "seek_company",
    {
      description:
        "A company's Seek profile: overview, size, industry, website, specialities, culture and values, perks, awards, " +
        "employee ratings by category (career, management, work-life balance, diversity, pay…) and Seek's AI summary of " +
        "its reviews. organisationId lists its jobs (seek_company_jobs or seek_search companyId). No sign-in.",
      inputSchema: { company: companyRef },
      annotations: READ,
    },
    ({ company: ref }) => guard(() => company(ref)),
  );

  server.registerTool(
    "seek_company_reviews",
    {
      description:
        "Employee reviews of a company: title, rating, pros, cons, role, location, tenure, salary view, category ratings " +
        "and any employer reply. Filter by location (a place name such as \"All Auckland\"; withLocations lists the ones it " +
        "has reviews for) and sort by recent or helpful. No sign-in.",
      inputSchema: {
        company: companyRef,
        page: z.number().int().min(1).optional(),
        perPage: z.number().int().min(1).max(30).optional(),
        sort: z.enum(["recent", "helpful"]).optional(),
        location: z.string().optional(),
        withLocations: z.boolean().optional().describe("Also list the locations reviews come from"),
      },
      annotations: READ,
    },
    ({ company: ref, page, perPage, sort, location, withLocations }) =>
      guard(async () => {
        const reviews = await companyReviews({ company: ref, page, perPage, sort, location });
        return withLocations ? { ...reviews, locations: await companyReviewLocations(ref) } : reviews;
      }),
  );

  server.registerTool(
    "seek_company_salaries",
    {
      description: "Salary ranges Seek has for roles at a company, against the industry average. No sign-in.",
      inputSchema: { company: companyRef },
      annotations: READ,
    },
    ({ company: ref }) => guard(() => companySalaries(ref)),
  );

  server.registerTool(
    "seek_company_jobs",
    {
      description: "A company's open jobs on Seek (its profile's Jobs tab), newest first. No sign-in.",
      inputSchema: {
        company: companyRef,
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ,
    },
    ({ company: ref, page, pageSize }) => guard(() => companyJobs(ref, page, pageSize)),
  );

  server.registerTool(
    "seek_company_review_feedback",
    {
      description:
        "Mark a company review helpful, or report it to Seek (reason: spam, disagree, personal_info, offensive, sensitive, " +
        "response_inappropriate, bias, others, with details). Taken as the signed-in user. confirm must be true.",
      inputSchema: {
        company: companyRef,
        reviewId: z.string(),
        action: z.enum(["helpful", "flag"]),
        reason: z.enum(REVIEW_FLAG_REASONS).optional(),
        details: z.string().optional().describe("For flag: what is wrong with the review"),
        confirm: z.literal(true),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ company: ref, reviewId, action, reason, details }) => guard(() => voteOrFlagReview({ company: ref, reviewId, action, reason, details })),
  );
}
