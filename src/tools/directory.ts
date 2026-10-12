import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contactRecruiter, personProfile, recruiterFilters, recruiterProfile, searchPeople, searchRecruiters } from "../directory.js";
import { guard } from "../result.js";

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const directoryType = z.enum(["recruiter", "agency"]).optional().describe("Default recruiter");

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
        "filters: true lists the accepted region, specialisation and role-type values. No sign-in.",
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
      },
      annotations: READ,
    },
    ({ filters, ...a }) => guard(() => (filters ? recruiterFilters() : searchRecruiters(a))),
  );

  server.registerTool(
    "seek_recruiter",
    {
      description:
        "A recruiter's or agency's directory profile (section profile: contact number, website, awards, recent placements, " +
        "open jobs, team), or one section in full: reviews, jobs, placements, team. No sign-in.",
      inputSchema: {
        slug: z.string().describe("From seek_recruiter_search, or a directory URL"),
        type: directoryType,
        section: z.enum(["profile", "reviews", "jobs", "placements", "team"]).optional(),
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
        "Send a recruiter or agency a message through Seek's directory; they receive it by email with the name, email and " +
        "phone given. It is a real message to a third party: confirm must be true.",
      inputSchema: {
        slug: z.string(),
        type: directoryType,
        name: z.string(),
        email: z.string(),
        message: z.string(),
        phone: z.string().optional(),
        jobId: z.string().optional().describe("A job of theirs the message is about"),
        confirm: z.literal(true),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ confirm: _c, ...a }) => guard(() => contactRecruiter(a)),
  );
}
