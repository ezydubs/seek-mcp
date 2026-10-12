import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { changeEmailStart, changeEmailVerify, deleteAccount, notificationSettings, updateNotifications } from "../settings.js";
import { guard } from "../result.js";

export function register(server: McpServer) {
  server.registerTool(
    "seek_notifications",
    {
      description:
        "Seek's email and push notification settings (Settings → Notifications). With no changes, lists every notification " +
        "with its id and channels. Each change sets one notification id (e.g. SavedSearch, NewJob, AppViewed, " +
        "MarketingNewsletter) on one channel, optionally with a frequency (daily / weekly / dynamic).",
      inputSchema: {
        changes: z
          .array(
            z.object({
              id: z.string().describe("Notification id from the list"),
              channel: z.enum(["email", "push"]),
              subscribe: z.boolean(),
              frequency: z.enum(["daily", "weekly", "dynamic"]).optional(),
            }),
          )
          .optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ changes }) => guard(() => (changes?.length ? updateNotifications(changes) : notificationSettings())),
  );

  server.registerTool(
    "seek_change_email",
    {
      description:
        "Change the account's sign-in email in two steps. With only newEmail, Seek sends a verification code to that address; " +
        "call again with newEmail and code to complete the change. Afterwards the account signs in with the new address.",
      inputSchema: {
        newEmail: z.string(),
        code: z.string().optional().describe("The verification code from the email Seek sent to newEmail"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    ({ newEmail, code }) => guard(() => (code ? changeEmailVerify(newEmail, code.trim()) : changeEmailStart(newEmail))),
  );

  server.registerTool(
    "seek_delete_account",
    {
      description:
        "PERMANENTLY delete the Seek account: profile, résumés, saved jobs and searches and application history. It cannot " +
        "be undone. Only use it when the user has explicitly asked for their account to be deleted. confirmEmail must be " +
        "the signed-in account's exact email address, or nothing happens.",
      inputSchema: {
        confirmEmail: z.string().describe("The account's current email address, typed out as confirmation"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    ({ confirmEmail }) => guard(() => deleteAccount(confirmEmail)),
  );
}
