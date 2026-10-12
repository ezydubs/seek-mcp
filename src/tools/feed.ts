import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { homeFeed, homeNudges, refineRecommendations } from "../feed.js";
import { guard } from "../result.js";

const roleUri = z.string().describe('Role title ontology URI (ontologyId from seek_suggest role_titles), e.g. "http://graph.seek.com/role-title/accountant"');
const locationId = z.number().int().describe("Seek location id (seek_suggest profile_locations), e.g. 1019 All Wellington");

export function register(server: McpServer) {
  server.registerTool(
    "seek_home_feed",
    {
      description:
        "The signed-in candidate's Seek home feed: recommended jobs (id, title, company, location, salary, work type, " +
        "listing date, badges, Seek's AI summary, and the \"not interested\" {reason, typeId} pairs seek_job_feedback " +
        "takes), company highlights (companyId for seek_company), market insights (the role title and location the feed " +
        "follows, with the weekly count of open roles and the ad-volume trend), profile performance (how often the profile " +
        "appeared in searches or was viewed, by activity), the salary prompt and the recsServiceToken " +
        "seek_refine_recommendations takes. refinementToken shows the feed as refined by seek_refine_recommendations; " +
        "market reads the trend for another role and location without saving it (seek_home_nudges saves it); " +
        "careerInsights adds Seek's AI career-insight suggestions. The feed often holds 100 or more jobs: they come 20 " +
        "at a time (page, pageSize) with totalJobs.",
      inputSchema: {
        refinementToken: z.string().optional().describe("From seek_refine_recommendations"),
        market: z.object({ roleUri, locationId }).optional().describe("Trend for this role title and location instead of the feed's own"),
        careerInsights: z.boolean().optional().describe("Also ask for Seek's career-insight suggestions (an experimental feed section)"),
        page: z.number().int().min(1).optional().describe("Page of recommended jobs, default 1"),
        pageSize: z.number().int().min(1).max(50).optional().describe("Jobs per page, default 20"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ refinementToken, market, careerInsights, page, pageSize }) =>
      guard(() => homeFeed({ refinementToken, market, careerInsights, page, pageSize })),
  );

  server.registerTool(
    "seek_refine_recommendations",
    {
      description:
        "Refine Seek's job recommendations by answering Seek's AI questions (the home page's \"Want better job " +
        "recommendations?\" card). Without answers it returns the questions, each with its id and options, and changes " +
        "nothing. answers sends the questions back with the chosen options: Seek re-ranks the account's recommendations " +
        "and the tool returns the refined jobs and a refinementToken for seek_home_feed. followUp: true with answers asks " +
        "Seek for follow-up questions based on the latest answer instead of submitting. Signed in.",
      inputSchema: {
        recsServiceToken: z.string().optional().describe("recsServiceToken from seek_home_feed or the questions; read from the feed when omitted"),
        answers: z
          .array(
            z.object({
              id: z.string().optional().describe("The question's id"),
              question: z.string().describe("The question text, as returned"),
              options: z.array(z.string()).describe("The question's options, as returned"),
              answers: z.array(z.string()).min(1).describe('Chosen options; an option listed as freeText takes the user\'s words as "<option>: <text>"'),
            }),
          )
          .optional()
          .describe("Every question answered so far, in order"),
        followUp: z.boolean().optional().describe("Ask for follow-up questions instead of submitting"),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ recsServiceToken, answers, followUp }) => guard(() => refineRecommendations({ recsServiceToken, answers, followUp })),
  );

  server.registerTool(
    "seek_home_nudges",
    {
      description:
        "The prompts Seek shows on its home and search pages. With no arguments it lists them and changes nothing: the " +
        "salary prompt (nudgeId, question and options) and the role title and location the home feed's market insights " +
        "follow. salaryAnswer answers or dismisses the salary prompt (option is one of its options, or \"Dismiss\"); " +
        "marketInsights changes that role title and location; confirmProfileUpToDate: true tells Seek the career " +
        "history is still current. Signed in.",
      inputSchema: {
        salaryAnswer: z
          .object({ nudgeId: z.string(), option: z.string().describe('An option value from the prompt, or "Dismiss"') })
          .optional(),
        marketInsights: z.object({ roleUri, locationId }).optional(),
        confirmProfileUpToDate: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ salaryAnswer, marketInsights, confirmProfileUpToDate }) =>
      guard(() => homeNudges({ salaryAnswer, marketInsights, confirmProfileUpToDate })),
  );
}
