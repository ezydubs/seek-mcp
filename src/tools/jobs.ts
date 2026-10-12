import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { classifications, profileOptions, suggest } from "../discover.js";
import { REPORT_REASONS, jobInsights, reportJob, requestJobMatch, similarJobs } from "../jobs.js";
import { jobPreferences, recommendedJobs, updateJobPreferences } from "../activity.js";
import { guard } from "../result.js";

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const jobId = z.string().describe('Seek job id, e.g. "94867040"');

export function register(server: McpServer) {
  server.registerTool(
    "seek_suggest",
    {
      description:
        "Seek's own autocomplete, which is also where the ids its forms need come from. kind: keywords and " +
        "search_locations complete job searches; profile_locations returns numeric location ids for seek_profile_update " +
        "and seek_preferences; role_titles, companies, schools, qualifications, skills, licences and languages return " +
        "the ontologyId to pass with that value to the profile tools; rights_to_work returns right-to-work option ids. " +
        "No sign-in.",
      inputSchema: {
        kind: z.enum([
          "keywords", "search_locations", "profile_locations", "role_titles", "companies", "schools",
          "qualifications", "skills", "licences", "languages", "rights_to_work",
        ]),
        query: z.string().describe('The text typed so far, e.g. "softw" or "ponsonby"'),
        count: z.number().int().min(1).max(20).optional(),
      },
      annotations: READ,
    },
    ({ kind, query, count }) => guard(() => suggest(kind, query, count)),
  );

  server.registerTool(
    "seek_classifications",
    {
      description:
        "Seek's job classifications and subclassifications with their ids (for seek_search's classification filters and " +
        "seek_preferences), plus the fixed choice lists behind profile fields (availability, work types, profile visibility). No sign-in.",
      inputSchema: {},
      annotations: READ,
    },
    () => guard(async () => ({ classifications: await classifications(), profileOptions: await profileOptions() })),
  );

  server.registerTool(
    "seek_similar_jobs",
    {
      description: "Jobs Seek recommends alongside an ad (the ad page's \"you may also be interested in\" list). No sign-in.",
      inputSchema: { id: jobId },
      annotations: READ,
    },
    ({ id }) => guard(() => similarJobs(id)),
  );

  server.registerTool(
    "seek_job_insights",
    {
      description:
        "What Seek works out about the signed-in candidate and one job: whether it is saved or applied to, which of the " +
        "ad's skills the profile matches, infers or lacks, whether the salary meets the candidate's expectation, the " +
        "applicant count and résumé/cover-letter shares, and Seek's AI job-match assessment (\"should I apply?\"). " +
        "requestAiMatch: true asks Seek to run that assessment now (it uses one of the account's limited allowances and " +
        "can take a few seconds; call again to read it).",
      inputSchema: {
        id: jobId,
        requestAiMatch: z.boolean().optional().describe("Ask Seek's AI to assess the fit now (uses an allowance)"),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ id, requestAiMatch }) =>
      guard(async () => (requestAiMatch ? { requested: await requestJobMatch(id), insights: await jobInsights(id) } : jobInsights(id))),
  );

  server.registerTool(
    "seek_report_job",
    {
      description:
        "Report a job ad to Seek's trust and safety team (fraud, discrimination, misleading content or pay below minimum " +
        "wage). The report goes to Seek with the given email for follow-up. confirm must be true.",
      inputSchema: {
        id: jobId,
        reason: z.enum(REPORT_REASONS),
        comment: z.string().max(400).describe("What is wrong with the ad (up to 400 characters)"),
        email: z.string().describe("Where Seek can follow up; normally the account's email"),
        confirm: z.literal(true).describe("Must be true: the report is sent to Seek"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ id, reason, comment, email }) => guard(() => reportJob({ id, reason, comment, email })),
  );

  server.registerTool(
    "seek_recommended_jobs",
    {
      description:
        "Seek's recommended-jobs feed for the signed-in candidate (the home page's Recommended list), with each job's " +
        "\"not interested\" reasons that seek_job_feedback accepts.",
      inputSchema: {},
      annotations: READ,
    },
    () => guard(() => recommendedJobs()),
  );

  server.registerTool(
    "seek_job_feedback",
    {
      description:
        "Tune Seek's recommendations. hide takes {reason, typeId} pairs from seek_recommended_jobs (e.g. not interested " +
        "in this company or role); unhide takes ids from the list this tool returns. With neither, lists what is hidden.",
      inputSchema: {
        hide: z.array(z.object({ reason: z.string(), typeId: z.string() })).optional(),
        unhide: z.array(z.string()).optional().describe("Preference item ids to remove"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ hide, unhide }) => guard(() => (hide?.length || unhide?.length ? updateJobPreferences({ hide, unhide }) : jobPreferences())),
  );
}
