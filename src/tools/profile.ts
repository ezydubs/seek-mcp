import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addLanguage, deleteAvatar, deleteLanguage, deleteLicence, deleteQualification, deleteRole, generateResume, profileSections,
  resumeDownloadLink, reviewSuggestedQualification, reviewSuggestedRole, setSummary, updatePreferences, updateSkills,
  uploadAvatar, upsertLicence, upsertQualification,
} from "../profile-sections.js";
import { profileOptions } from "../discover.js";
import { guard } from "../result.js";

const monthYear = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) });
const keyword = z.object({
  text: z.string(),
  ontologyId: z.string().optional().describe("From seek_suggest; omit for free text"),
});
const WRITE = { readOnlyHint: false, openWorldHint: true } as const;

export function register(server: McpServer) {
  server.registerTool(
    "seek_profile_summary",
    {
      description: "Set the Seek profile's personal summary (the paragraph at the top of the profile). An empty string clears it.",
      inputSchema: { text: z.string() },
      annotations: { ...WRITE, idempotentHint: true },
    },
    ({ text }) => guard(() => setSummary(text)),
  );

  server.registerTool(
    "seek_role_manage",
    {
      description:
        "Delete a career-history role, or accept / dismiss a role Seek suggested from a résumé (seek_profile sections " +
        "[\"suggestedRoles\"] lists them). Adding and editing roles is seek_add_role.",
      inputSchema: {
        id: z.string().describe("Role id (UUID)"),
        action: z.enum(["delete", "confirm", "reject"]),
        contextId: z.string().optional().describe("For suggestions: the résumé they came from (defaults to the default résumé)"),
      },
      annotations: { ...WRITE, destructiveHint: true },
    },
    ({ id, action, contextId }) =>
      guard(() => (action === "delete" ? deleteRole(id) : reviewSuggestedRole(id, action === "confirm", contextId))),
  );

  server.registerTool(
    "seek_education",
    {
      description:
        "Add, edit or delete a qualification in the profile's Education section, or accept / dismiss one Seek suggested " +
        "from a résumé. For add/update, use seek_suggest (schools, qualifications) to get the ontology ids Seek prefers; " +
        "free text works too. A completed qualification takes completionYear; one in progress takes expectedCompletion. " +
        "update changes only the fields given. A verified qualification (verified: true in seek_profile sections " +
        "[\"education\"], checked by a third party) takes only highlights on update, and delete refuses it with the " +
        "verifier's removal link.",
      inputSchema: {
        action: z.enum(["add", "update", "delete", "confirm", "reject"]),
        id: z.string().optional().describe("Qualification id, for update/delete/confirm/reject"),
        name: z.string().optional().describe('e.g. "Bachelor of Commerce"'),
        nameOntologyId: z.string().optional(),
        institute: z.string().optional().describe('e.g. "University of Auckland"'),
        instituteOntologyId: z.string().optional(),
        completed: z.boolean().optional(),
        completionYear: z.number().int().optional(),
        expectedCompletion: monthYear.optional(),
        highlights: z.string().optional(),
      },
      annotations: { ...WRITE, destructiveHint: true },
    },
    (a) =>
      guard(async () => {
        if (a.action === "delete") return deleteQualification(need(a.id, "id"));
        if (a.action === "confirm" || a.action === "reject") return reviewSuggestedQualification(need(a.id, "id"), a.action === "confirm");
        const update = a.action === "update";
        return upsertQualification({
          id: update ? need(a.id, "id") : undefined,
          name: update ? a.name : need(a.name, "name"),
          nameOntologyId: a.nameOntologyId,
          institute: update ? a.institute : need(a.institute, "institute"),
          instituteOntologyId: a.instituteOntologyId,
          completed: a.completed,
          completionYear: a.completionYear,
          expectedCompletion: a.expectedCompletion,
          highlights: a.highlights,
        });
      }),
  );

  server.registerTool(
    "seek_licence",
    {
      description:
        "Add, edit or delete a licence or certification on the profile. seek_suggest kind licences gives the ontology id. " +
        "Omit expiryDate for one that does not expire. update changes only the fields given. A verified licence " +
        "(verified: true in seek_profile sections [\"licences\"], checked by a third party) takes only description on " +
        "update, and delete refuses it with the verifier's removal link.",
      inputSchema: {
        action: z.enum(["add", "update", "delete"]),
        id: z.string().optional().describe("Licence id, for update/delete"),
        name: z.string().optional().describe('e.g. "Full Driver Licence (Class 1)"'),
        ontologyId: z.string().optional(),
        issuingOrganisation: z.string().optional(),
        issueDate: monthYear.optional(),
        expiryDate: monthYear.optional(),
        description: z.string().optional(),
      },
      annotations: { ...WRITE, destructiveHint: true },
    },
    (a) =>
      guard(async () =>
        a.action === "delete"
          ? deleteLicence(need(a.id, "id"))
          : upsertLicence({
              id: a.action === "update" ? need(a.id, "id") : undefined,
              name: a.action === "update" ? a.name : need(a.name, "name"),
              ontologyId: a.ontologyId,
              issuingOrganisation: a.issuingOrganisation,
              issueDate: a.issueDate,
              expiryDate: a.expiryDate,
              description: a.description,
            }),
      ),
  );

  server.registerTool(
    "seek_skills",
    {
      description:
        "The profile's skills. With no arguments, lists them and Seek's suggested skills. set replaces the whole list; " +
        "add and remove change it. seek_suggest kind skills gives ontology ids.",
      inputSchema: {
        set: z.array(keyword).optional(),
        add: z.array(keyword).optional(),
        remove: z.array(z.string()).optional().describe("Skill names to remove"),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    ({ set, add, remove }) =>
      guard(() => (set || add?.length || remove?.length ? updateSkills({ set, add, remove }) : profileSections(["skills", "suggestedSkills"]))),
  );

  server.registerTool(
    "seek_language",
    {
      description: "Add a language to the profile (seek_suggest kind languages gives the ontology id), or delete one by id.",
      inputSchema: {
        action: z.enum(["add", "delete"]),
        name: z.string().optional().describe('e.g. "Te Reo Māori"'),
        ontologyId: z.string().optional(),
        id: z.string().optional().describe("Language entry id, for delete"),
      },
      annotations: { ...WRITE, destructiveHint: true },
    },
    ({ action, name, ontologyId, id }) =>
      guard(() => (action === "add" ? addLanguage(need(name, "name"), ontologyId) : deleteLanguage(need(id, "id")))),
  );

  server.registerTool(
    "seek_preferences",
    {
      description:
        "The profile's next-role preferences and privacy: availability, preferred work types, locations, classification, " +
        "role titles, minimum salary, rights to work, approachability and profile visibility. With no arguments, reads them " +
        "all together with the allowed values. Ids come from seek_classifications (classification, work types, availability, " +
        "visibility) and seek_suggest (profile_locations, rights_to_work, role_titles). Visibility controls who can find and " +
        "view the profile: check the options before changing it.",
      inputSchema: {
        availabilityId: z.number().int().optional().describe("0 now, 2 two weeks, 4, 8, 12+ weeks"),
        workTypeIds: z.array(z.number().int()).optional().describe("1 full time, 2 part time, 3 contract, 4 casual"),
        preferredLocationIds: z.array(z.number().int()).optional().describe("Location ids from seek_suggest profile_locations"),
        classification: z.object({ id: z.number().int(), subclassificationId: z.number().int() }).optional(),
        addRoleTitles: z.array(keyword).optional(),
        removeRoleTitles: z.array(z.string()).optional(),
        salary: z
          .object({
            amount: z.number().int().nullable().describe("Minimum expected; null clears it"),
            type: z.enum(["Annual", "Monthly", "Hourly"]),
            countryCode: z.string().optional().describe('Default "NZ"'),
          })
          .optional(),
        rightsToWork: z
          .array(z.object({ countryCode: z.string(), optionId: z.string().describe("From seek_suggest rights_to_work") }))
          .optional(),
        approachable: z.boolean().optional().describe("Show employers you are open to being approached"),
        visibility: z.string().optional().describe('A visibility id from seek_classifications, e.g. "Standard", "Limited", "Hidden"'),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    (a) =>
      guard(async () => {
        const any = Object.values(a).some((v) => v !== undefined);
        if (!any) {
          const [now, options] = await Promise.all([
            profileSections([
              "availability", "workTypes", "preferredLocations", "preferredClassification", "preferredRoleTitles",
              "salary", "rightsToWork", "approachable", "visibility",
            ]),
            profileOptions(),
          ]);
          return { ...now, options };
        }
        return updatePreferences(a);
      }),
  );

  server.registerTool(
    "seek_avatar",
    {
      description: "Upload a JPG or PNG as the profile photo, or delete the current one.",
      inputSchema: {
        action: z.enum(["upload", "delete"]),
        path: z.string().optional().describe("Absolute path to the image, for upload"),
      },
      annotations: { ...WRITE, destructiveHint: true },
    },
    ({ action, path }) => guard(() => (action === "upload" ? uploadAvatar(need(path, "path")) : deleteAvatar())),
  );

  server.registerTool(
    "seek_resume_download",
    {
      description: "A download link for one of the profile's résumés (ids from seek_profile).",
      inputSchema: { id: z.string().describe("Résumé id (a UUID)") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ id }) => guard(() => resumeDownloadLink(id.trim())),
  );

  server.registerTool(
    "seek_resume_generate",
    {
      description:
        "Have Seek build a résumé document from the profile (career history, education, skills…) and add it to the " +
        "profile's résumés. It does not become the default unless set with seek_resume_set_default.",
      inputSchema: {},
      annotations: WRITE,
    },
    () => guard(() => generateResume()),
  );
}

function need<T>(v: T | undefined, name: string): T {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) throw new Error(`This action needs ${name}`);
  return v;
}
