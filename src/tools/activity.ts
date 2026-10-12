import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  applicationDetail, createSavedSearch, deleteSavedSearch, markPreferredApplication, priorityApplyCredit, removeAppliedJob,
  savedSearches, setJobNote, setSavedSearchAlerts,
} from "../activity.js";
import { startExternalApplication } from "../apply.js";
import { guard } from "../result.js";
import { searchFilterShape, toSearchParams } from "./search-shape.js";

const jobId = z.string().describe('Seek job id, e.g. "94867040"');

export function register(server: McpServer) {
  server.registerTool(
    "seek_saved_searches",
    {
      description:
        "The signed-in user's saved searches (job alerts). action list (default) shows them with their filters and new-job " +
        "counts; create saves a search from the same filters seek_search takes (Seek then emails new matches); delete " +
        "removes one by id; alerts turns a saved search's email alerts on or off.",
      inputSchema: {
        action: z.enum(["list", "create", "delete", "alerts"]).optional(),
        id: z.string().optional().describe("Saved search id, for delete and alerts"),
        emailAlerts: z.boolean().optional().describe("For alerts: true to receive emails, false to stop them"),
        ...searchFilterShape,
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (a) =>
      guard(async () => {
        switch (a.action ?? "list") {
          case "list":
            return savedSearches();
          case "create":
            return createSavedSearch(toSearchParams(a));
          case "delete":
            if (!a.id) throw new Error("delete needs the saved search id");
            return deleteSavedSearch(a.id);
          case "alerts":
            if (!a.id || a.emailAlerts == null) throw new Error("alerts needs id and emailAlerts");
            return setSavedSearchAlerts(a.id, a.emailAlerts);
        }
      }),
  );

  server.registerTool(
    "seek_job_note",
    {
      description:
        "Write or clear the private note on a saved or applied job (the notes field on Seek's My Activity pages). " +
        "note: null clears it.",
      inputSchema: {
        id: jobId,
        list: z.enum(["saved", "applied"]),
        note: z.string().nullable().describe("The note text; null to remove it"),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ id, list, note }) => guard(() => setJobNote({ id, list, note })),
  );

  server.registerTool(
    "seek_application",
    {
      description:
        "One of the user's applications. action details (default): download links for the résumé and cover letter that " +
        "were sent, and Seek's applicant insights for the job. credits: the account's priority-apply credits. prioritise: " +
        "spend one credit to flag the application as one of strong interest. remove: take it off the Applied jobs list " +
        "(this does not withdraw it; Seek has no withdrawal).",
      inputSchema: {
        id: jobId.optional(),
        action: z.enum(["details", "credits", "prioritise", "remove"]).optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    ({ id, action }) =>
      guard(async () => {
        const act = action ?? "details";
        if (act === "credits") return priorityApplyCredit();
        if (!id) throw new Error(`${act} needs the job id`);
        if (act === "details") return applicationDetail(id);
        if (act === "prioritise") return markPreferredApplication(id);
        return removeAppliedJob(id);
      }),
  );

  server.registerTool(
    "seek_apply_external",
    {
      description:
        "For a job that takes applications on the employer's own site (seek_apply_requirements says externalApply): " +
        "record it in the user's Applied jobs on Seek, as clicking \"Apply on employer site\" does, and return the employer's " +
        "application address to complete there. Nothing is sent to the employer.",
      inputSchema: { id: jobId },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ id }) => guard(() => startExternalApplication(id.trim())),
  );
}
