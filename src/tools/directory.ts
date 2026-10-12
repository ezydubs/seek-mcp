import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  callRecruiter, contactRecruiter, featuredRecruiters, personProfile, recruiterFilters, recruiterProfile, searchPeople, searchRecruiters,
} from "../directory.js";
import { guard } from "../result.js";

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const directoryType = z.enum(["recruiter", "agency"]).optional().describe("Default recruiter");

function need<T>(v: T | undefined, name: string): T {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) throw new Error(`This method needs ${name}`);
  return v;
}

export function register(server: McpServer) {
  server.registerTool(
    "seek_people_search",
    {
      description:
        "Seek's People search: profiles candidates have chosen to make public, found by the person's name and optionally narrowed " +
        "by role titles, companies and locations (latestOnly matches only each person's latest role). Returns names, " +
        "locations and work history as Seek shows them.",
      inputSchema: {
        query: z.string().describe("Name or keywords"),
        roleTitles: z.array(z.string()).optional(),
        companies: z.array(z.string()).optional(),
        locations: z.array(z.string()).optional(),
        latestOnly: z.boolean().optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
      },
      annotations: READ,
    },
    (a) => guard(() => searchPeople(a)),
  );

  server.registerTool(
    "seek_person",
    {
      description: "One public Seek profile by slug or profile URL (from seek_people_search): summary, roles, education, licences, skills, languages.",
      inputSchema: { slug: z.string() },
      annotations: READ,
    },
    ({ slug }) => guard(() => personProfile(slug)),
  );

  server.registerTool(
    "seek_recruiter_search",
    {
      description:
        "Search Seek's recruiter directory for recruiters or agencies, with ratings and review counts. Filter by the job " +
        "titles they place (placementTitle), specialisations, role types (Permanent / Fixed-term / Contract) and region. " +
        "filters: true lists the accepted region, specialisation and role-type values. featured: true lists the recruiters " +
        "or agencies (type) the directory's home page features for New Zealand instead of searching. No sign-in.",
      inputSchema: {
        type: directoryType,
        query: z.string().optional().describe("Name"),
        placementTitle: z.string().optional().describe('e.g. "accountant"'),
        specialisations: z.array(z.string()).optional(),
        roleTypes: z.array(z.string()).optional(),
        region: z.string().optional().describe('e.g. "Auckland", "Canterbury"'),
        reviewedInLast12Months: z.boolean().optional().describe("Default true, as the site searches"),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
        filters: z.boolean().optional(),
        featured: z.boolean().optional().describe("Seek's featured list for type (recruiter or agency); other filters are ignored"),
      },
      annotations: READ,
    },
    ({ filters, featured, ...a }) =>
      guard(() => (filters ? recruiterFilters() : featured ? featuredRecruiters(a.type) : searchRecruiters(a))),
  );

  server.registerTool(
    "seek_recruiter",
    {
      description:
        "A recruiter's or agency's directory profile (section profile: contact number, website, awards, recent placements, " +
        "open jobs, team), or one section in full: reviews, jobs, placements, team, awards (every award with its years, " +
        "result and programme; pageSize caps how many). No sign-in.",
      inputSchema: {
        slug: z.string().describe("From seek_recruiter_search, or a directory URL"),
        type: directoryType,
        section: z.enum(["profile", "reviews", "jobs", "placements", "team", "awards"]).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
      },
      annotations: READ,
    },
    (a) => guard(() => recruiterProfile(a)),
  );

  server.registerTool(
    "seek_contact_recruiter",
    {
      description:
        "Contact a recruiter or agency through Seek's directory. method email (the default) sends them a message they " +
        "receive by email with the name, email and phone given; name, email and message are required. method call does " +
        "what the directory's Call button does: it needs seek_auth, checks the account's recruiter-contact limit, records " +
        "the call with Seek (nobody is called or messaged) and returns the number to ring. Both are real actions on the " +
        "account: confirm must be true.",
      inputSchema: {
        slug: z.string(),
        type: directoryType,
        method: z.enum(["email", "call"]).optional().describe('Default "email"'),
        name: z.string().optional().describe("For email: the sender's name"),
        email: z.string().optional().describe("For email: where the recruiter replies"),
        message: z.string().optional().describe("For email"),
        phone: z.string().optional().describe("For email: a number the recruiter may call"),
        jobId: z.string().optional().describe("For email: a job of theirs the message is about"),
        confirm: z.literal(true),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ confirm: _c, method, ...a }) =>
      guard(async () =>
        method === "call"
          ? callRecruiter({ slug: a.slug, type: a.type })
          : contactRecruiter({
              slug: a.slug,
              type: a.type,
              name: need(a.name, "name"),
              email: need(a.email, "email"),
              message: need(a.message, "message"),
              phone: a.phone,
              jobId: a.jobId,
            }),
      ),
  );
}
