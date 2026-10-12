import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { gql, sgql } from "./auth.js";
import { COUNTRY, LANGUAGE, LOCALE, ORIGIN, PLATFORM, TIMEZONE, ZONE, clean, ontology } from "./seek.js";

type Vars = Record<string, unknown>;
const LZ = { languageCode: LANGUAGE, zone: ZONE };

const markVerified = (x: any) => (x?.credential ? { ...x, verified: true } : x);

const suggestion = (s: any) => ({
  message: s.message,
  action: s.action?.label,
  section: s.action?.context?.card,
  field: s.action?.context?.field,
  itemId: s.action?.context?.itemId,
});

function privacyNotes(r: any) {
  if (!r) return null;
  const sections: Array<{ heading?: string; text: string[] }> = [];
  for (const p of r.longParagraphs ?? []) {
    if (p.isEmphasized) sections.push({ heading: p.value, text: [] });
    else if (sections.length) sections[sections.length - 1].text.push(p.value);
    else sections.push({ text: [p.value] });
  }
  return { summary: (r.shortParagraphs ?? []).map((p: any) => p.value).join(" "), sections };
}

const SECTIONS: Record<string, { doc: Parameters<typeof sgql>[0]; vars: Vars; pick: (d: any) => unknown }> = {
  summary: { doc: "GetCareerObjectives", vars: {}, pick: (d) => d.viewer?.careerObjectives?.personalStatement ?? null },
  roles: { doc: "GetConfirmedRoles", vars: {}, pick: (d) => d.viewer?.confirmedRoles },
  suggestedRoles: { doc: "GetUnconfirmedRoles", vars: {}, pick: (d) => d.viewer?.unconfirmedRoles },
  education: { doc: "GetConfirmedQualifications", vars: LZ, pick: (d) => d.viewer?.confirmedQualifications?.map(markVerified) },
  suggestedEducation: { doc: "GetUnconfirmedQualifications", vars: LZ, pick: (d) => d.viewer?.unconfirmedQualifications },
  licences: { doc: "GetLicences", vars: LZ, pick: (d) => d.viewer?.licences?.map(markVerified) },
  skills: { doc: "GetSkills", vars: {}, pick: (d) => d.viewer?.skills2?.map((s: any) => s.keyword) },
  suggestedSkills: { doc: "GetSuggestedSkills", vars: LZ, pick: (d) => d.viewer?.suggestedSkills?.map((s: any) => s.keyword) },
  languages: { doc: "GetLanguageProficiencies", vars: {}, pick: (d) => d.viewer?.languageProficiencies },
  availability: { doc: "GetAvailability", vars: { languageCode: LANGUAGE }, pick: (d) => d.viewer?.availability },
  workTypes: { doc: "GetWorkTypes", vars: {}, pick: (d) => d.viewer?.workTypes?.map((w: any) => w.id) },
  preferredLocations: { doc: "GetPreferredLocations2", vars: LZ, pick: (d) => d.viewer?.preferredLocations2 },
  preferredClassification: { doc: "GetPreferredClassification", vars: {}, pick: (d) => d.viewer?.preferredClassification },
  preferredRoleTitles: { doc: "GetPreferredRoleTitleList", vars: {}, pick: (d) => d.viewer?.preferredRoleTitleList?.roleTitles },
  salary: { doc: "GetSalaryPreferences", vars: { countryCode: COUNTRY, languageCode: LANGUAGE }, pick: (d) => d.viewer?.salaryPreferences2 },
  rightsToWork: { doc: "GetRightsToWork", vars: LZ, pick: (d) => d.viewer?.rightsToWork },
  approachable: { doc: "GetApproachability", vars: {}, pick: (d) => d.viewer?.approachability?.approachable ?? null },
  visibility: { doc: "GetProfileVisibility2", vars: { locale: LOCALE }, pick: (d) => d.viewer?.profileVisibility2 },
  avatar: { doc: "GetProfileAvatar", vars: {}, pick: (d) => d.viewer?.profileAvatar },
  strength: { doc: "GetScore", vars: LZ, pick: (d) => d.viewer?.score },
  suggestions: { doc: "GetSuggestions", vars: LZ, pick: (d) => d.viewer?.profileSuggestions?.map(suggestion) },
  activity: { doc: "GetProfileInsights", vars: { zone: ZONE, locale: LOCALE, timezone: TIMEZONE }, pick: (d) => d.viewer?.profileInsights2 },
  verifications: { doc: "getVerifications", vars: { zone: ZONE, locale: LOCALE }, pick: (d) => d.viewer?.profileVerifications },
  references: { doc: "getReferenceChecks", vars: { locale: LOCALE }, pick: (d) => d.viewer?.referenceChecks },
  publicProfile: { doc: "GetPublicProfile", vars: { zone: ZONE, locale: LOCALE, platform: PLATFORM }, pick: (d) => d.viewer?.publicProfile },
  resumePrivacy: { doc: "GetResumePrivacyDisclaimers", vars: LZ, pick: (d) => privacyNotes(d.resumePrivacyDisclaimers) },
};
export const PROFILE_SECTIONS = Object.keys(SECTIONS) as [string, ...string[]];

export async function profileSections(names: string[]) {
  const wanted = names.includes("all") ? PROFILE_SECTIONS : names;
  const out: Record<string, unknown> = {};
  const failed: Record<string, string> = {};
  await Promise.all(
    wanted.map(async (n) => {
      const s = SECTIONS[n];
      if (!s) throw new Error(`Unknown profile section "${n}" (sections: ${PROFILE_SECTIONS.join(", ")})`);
      try {
        out[n] = clean(s.pick(await sgql(s.doc, s.vars, { partialOk: true })) ?? null);
      } catch (e) {
        failed[n] = (e as Error).message;
      }
    }),
  );
  if (Object.keys(failed).length === wanted.length) throw new Error(Object.values(failed)[0]);
  return Object.keys(failed).length ? { ...out, failed } : out;
}

export async function setSummary(text: string) {
  const d = await sgql("UpdateCareerObjectives", { careerObjectivesData: { personalStatement: text } });
  return { summary: d?.updateCareerObjectives?.viewer?.careerObjectives?.personalStatement ?? text };
}

export async function deleteRole(id: string) {
  await sgql("DeleteRole", { input: { id } });
  return { deleted: id, roles: await profileSections(["roles"]).then((r: any) => r.roles) };
}

async function defaultResumeId(): Promise<string> {
  const r = await gql(`query GetResumes { viewer { _id resumes { id isDefault } } }`);
  const list = r?.viewer?.resumes ?? [];
  return (list.find((x: any) => x.isDefault) ?? list[0])?.id ?? "";
}

export async function reviewSuggestedRole(id: string, accept: boolean, contextId?: string) {
  const ctx = contextId ?? (await defaultResumeId());
  if (!accept) {
    await sgql("RejectRole", { id, contextId: ctx, languageCode: LANGUAGE });
    return { id, rejected: true };
  }
  const list: any[] = (await profileSections(["suggestedRoles"]) as any).suggestedRoles ?? [];
  const r = list.find((x) => x.id === id);
  if (!r) throw new Error(`No suggested role ${id}; list them with seek_profile sections ["suggestedRoles"]`);
  await sgql("ConfirmRole", {
    input: {
      id,
      title: ontology(r.title?.text, r.title?.ontologyId),
      company: ontology(r.company?.text, r.company?.ontologyId),
      ...(r.seniority?.text ? { seniority: ontology(r.seniority.text, r.seniority.ontologyId) } : {}),
      from: { year: r.from.year, month: r.from.month },
      ...(r.to ? { to: { year: r.to.year, month: r.to.month } } : {}),
      ...(r.achievements ? { achievements: r.achievements } : {}),
    },
    contextId: ctx,
    languageCode: LANGUAGE,
  });
  return { id, confirmed: true };
}

export interface QualificationArgs {
  id?: string;
  name: string;
  nameOntologyId?: string;
  institute: string;
  instituteOntologyId?: string;
  completed: boolean;
  completionYear?: number;
  expectedCompletion?: { year: number; month: number };
  highlights?: string;
}

const qualificationInput = (q: QualificationArgs) => ({
  id: q.id ?? randomUUID(),
  name: ontology(q.name, q.nameOntologyId),
  institute: ontology(q.institute, q.instituteOntologyId),
  completed: q.completed,
  ...(q.completed && q.completionYear ? { completionYear: q.completionYear } : {}),
  ...(!q.completed && q.expectedCompletion ? { expectedCompletionDate: q.expectedCompletion } : {}),
  ...(q.highlights ? { highlights: q.highlights } : {}),
});

async function find(section: "education" | "licences", id: string): Promise<any> {
  const list: any[] = ((await profileSections([section])) as any)[section] ?? [];
  return list.find((x) => x.id === id);
}

async function existing(section: "education" | "licences", id: string): Promise<any> {
  const hit = await find(section, id);
  if (!hit) throw new Error(`No ${section === "education" ? "qualification" : "licence"} ${id} on the profile (see seek_profile sections ["${section}"])`);
  return hit;
}

function verifiedOnly(what: string, cur: any, allowed: string, given: Record<string, unknown>) {
  const other = Object.keys(given).filter((k) => k !== "id" && k !== allowed && given[k] !== undefined);
  const manage = cur.credential?.manageVerificationUrl;
  if (other.length) {
    throw new Error(
      `${what} ${cur.id} is verified, so Seek only lets its ${allowed} change, not ${other.join(", ")}` +
        (manage ? `; the verified details are managed at ${manage}` : ""),
    );
  }
  if (given[allowed] === undefined) throw new Error(`${what} ${cur.id} is verified: pass ${allowed}, the only field Seek lets change`);
}

function refuseVerifiedDelete(what: string, cur: any) {
  if (!cur?.credential) return;
  const url = cur.credential.deleteVerificationUrl;
  throw new Error(
    `${what} ${cur.id} is verified; Seek removes a verified credential through its verifier rather than deleting it from the profile` +
      (url ? `: ${url}` : ""),
  );
}

export async function upsertQualification(q: Partial<QualificationArgs> & { id?: string }) {
  const cur = q.id ? await existing("education", q.id) : {};
  if (cur.credential) return updateVerifiedQualification(cur, q);
  const name = q.name ?? cur.name?.text;
  const institute = q.institute ?? cur.institute?.text;
  if (!name || !institute) throw new Error("A qualification needs name and institute");
  const qualification = qualificationInput({
    id: q.id,
    name,
    nameOntologyId: q.name ? q.nameOntologyId : cur.name?.ontologyId,
    institute,
    instituteOntologyId: q.institute ? q.instituteOntologyId : cur.institute?.ontologyId,
    completed: q.completed ?? cur.completed ?? true,
    completionYear: q.completionYear ?? cur.completionDate?.year ?? cur.completionYear,
    expectedCompletion: q.expectedCompletion ?? cur.expectedCompletionDate ?? undefined,
    highlights: q.highlights ?? cur.highlights ?? undefined,
  });
  await sgql("UpdateQualification", { qualification, ...LZ });
  return { id: qualification.id, saved: true, education: (await profileSections(["education"]) as any).education };
}

async function updateVerifiedQualification(cur: any, q: Partial<QualificationArgs>) {
  verifiedOnly("Qualification", cur, "highlights", q);
  const d = await sgql("UpdateVerifiedQualification", { verifiedQualificationData: { id: cur.id, highlights: q.highlights || null }, ...LZ });
  const list = d?.updateVerifiedQualification?.viewer?.confirmedQualifications;
  return {
    id: cur.id,
    saved: true,
    verified: true,
    education: list ? clean(list.map(markVerified)) : (await profileSections(["education"]) as any).education,
  };
}

export async function deleteQualification(id: string) {
  refuseVerifiedDelete("Qualification", await find("education", id));
  await sgql("DeleteQualification", { qualificationId: { id }, ...LZ });
  return { deleted: id };
}

export async function reviewSuggestedQualification(id: string, accept: boolean) {
  if (!accept) {
    await sgql("RejectQualification", { qualification: { id, dataType: "Education" }, ...LZ });
    return { id, rejected: true };
  }
  const list: any[] = (await profileSections(["suggestedEducation"]) as any).suggestedEducation ?? [];
  const q = list.find((x) => x.id === id);
  if (!q) throw new Error(`No suggested qualification ${id}; list them with seek_profile sections ["suggestedEducation"]`);
  await sgql("ConfirmQualification", {
    qualification: qualificationInput({
      id,
      name: q.name?.text,
      nameOntologyId: q.name?.ontologyId,
      institute: q.institute?.text,
      instituteOntologyId: q.institute?.ontologyId,
      completed: !!q.completed,
      completionYear: q.completionDate?.year ?? q.completionYear,
      highlights: q.highlights,
    }),
    ...LZ,
  });
  return { id, confirmed: true };
}

export interface LicenceArgs {
  id?: string;
  name: string;
  ontologyId?: string;
  issuingOrganisation?: string;
  issueDate?: { year: number; month: number };
  expiryDate?: { year: number; month: number };
  description?: string;
}

const monthYearOf = (d: any) => (d?.year && d?.month ? { year: d.year, month: d.month } : null);

export async function upsertLicence(l: Partial<LicenceArgs> & { id?: string }) {
  const cur = l.id ? await existing("licences", l.id) : {};
  if (cur.credential) return updateVerifiedLicence(cur, l);
  const id = l.id ?? randomUUID();
  const name = l.name ?? cur.name?.text;
  if (!name) throw new Error("A licence needs a name");
  const expiryDate = l.expiryDate ?? monthYearOf(cur.expiryDate);
  await sgql("UpdateLicence", {
    licenceData: {
      id,
      name: ontology(name, l.name ? l.ontologyId : cur.name?.ontologyId),
      issuingOrganisation: l.issuingOrganisation ?? cur.issuingOrganisation ?? null,
      issueDate: l.issueDate ?? monthYearOf(cur.issueDate),
      expiryDate,
      noExpiryDate: !expiryDate,
      description: l.description ?? cur.description ?? null,
    },
    ...LZ,
  });
  return { id, saved: true, licences: (await profileSections(["licences"]) as any).licences };
}

async function updateVerifiedLicence(cur: any, l: Partial<LicenceArgs>) {
  verifiedOnly("Licence", cur, "description", l);
  await sgql("UpdateVerifiedLicence", { verifiedLicenceData: { id: cur.id, description: l.description || null } });
  return { id: cur.id, saved: true, verified: true, licences: (await profileSections(["licences"]) as any).licences };
}

export async function deleteLicence(id: string) {
  refuseVerifiedDelete("Licence", await find("licences", id));
  await sgql("DeleteLicence", { deleteLicenceInput: { id }, ...LZ });
  return { deleted: id };
}

export type Keyword = { text: string; ontologyId?: string | null };
const sameKeyword = (a: Keyword, b: Keyword) => a.text.trim().toLowerCase() === b.text.trim().toLowerCase();

export async function updateSkills(p: { set?: Keyword[]; add?: Keyword[]; remove?: string[] }) {
  let skills: Keyword[] = p.set ?? ((await profileSections(["skills"]) as any).skills ?? []);
  for (const k of p.add ?? []) if (!skills.some((s) => sameKeyword(s, k))) skills.push(k);
  if (p.remove?.length) skills = skills.filter((s) => !p.remove!.some((r) => sameKeyword(s, { text: r })));
  await sgql("UpdateSkills", { skillsData: { skills: skills.map((s) => ({ keyword: ontology(s.text, s.ontologyId) })) } });
  return { skills: skills.map((s) => s.text) };
}

export async function addLanguage(name: string, ontologyId?: string, id?: string) {
  const langId = id ?? randomUUID();
  await sgql("UpdateLanguageProficiency", { updateLanguageProficiencyInput: { id: langId, name: ontology(name, ontologyId) } });
  return { id: langId, language: name };
}

export async function deleteLanguage(id: string) {
  await sgql("DeleteLanguageProficiency", { deleteLanguageProficiencyInput: { id } });
  return { deleted: id };
}

export interface PreferenceArgs {
  availabilityId?: number;
  workTypeIds?: number[];
  preferredLocationIds?: number[];
  classification?: { id: number; subclassificationId: number };
  addRoleTitles?: Keyword[];
  removeRoleTitles?: string[];
  salary?: { amount: number | null; type: "Annual" | "Monthly" | "Hourly"; countryCode?: string };
  rightsToWork?: Array<{ countryCode: string; optionId: string }>;
  approachable?: boolean;
  visibility?: string;
}

export async function updatePreferences(p: PreferenceArgs) {
  const done: string[] = [];
  if (p.availabilityId != null) {
    await sgql("UpdateAvailability", { availability: { id: p.availabilityId }, languageCode: LANGUAGE });
    done.push("availability");
  }
  if (p.workTypeIds) {
    await sgql("UpdatePreferredWorkTypes", { workTypesData: { ids: p.workTypeIds } });
    done.push("workTypes");
  }
  if (p.preferredLocationIds) {
    await sgql("UpdatePreferredLocations2", {
      input: { preferredLocations: p.preferredLocationIds.map((id) => ({ id })) },
      countryCode: COUNTRY, ...LZ,
    });
    done.push("preferredLocations");
  }
  if (p.classification) {
    await sgql("UpdatePreferredClassification", {
      input: { classification: { id: p.classification.id, subClassification: { id: p.classification.subclassificationId } } },
    });
    done.push("preferredClassification");
  }
  if (p.addRoleTitles?.length || p.removeRoleTitles?.length) {
    await sgql("UpdatePreferredRoleTitleList", {
      input: {
        add: (p.addRoleTitles ?? []).map((t) => ({ title: t.text, ...(t.ontologyId ? { ontology: ontology(t.text, t.ontologyId) } : {}) })),
        remove: (p.removeRoleTitles ?? []).map((title) => ({ title })),
      },
    });
    done.push("preferredRoleTitles");
  }
  if (p.salary) {
    const countryCode = p.salary.countryCode ?? COUNTRY;
    const current: any[] = (await profileSections(["salary"]) as any).salary ?? [];
    const existing = current.find((s) => s.country?.countryCode === countryCode);
    await sgql("UpdateSalaryPreferences", {
      input: {
        salaryPreferences: [{ id: existing?.id ?? randomUUID(), countryCode, amount: p.salary.amount, salaryType: p.salary.type }],
      },
      countryCode, languageCode: LANGUAGE,
    });
    done.push("salary");
  }
  if (p.rightsToWork) {
    const current: any[] = (await profileSections(["rightsToWork"]) as any).rightsToWork ?? [];
    const given = new Set(p.rightsToWork.map((r) => r.countryCode));
    const kept = current
      .filter((c) => c.country?.countryCode && !given.has(c.country.countryCode) && c.type2?.id)
      .map((c) => ({ id: c.id, countryCode: c.country.countryCode, type2: { id: c.type2.id } }));
    await sgql("UpdateRightsToWork", {
      input: {
        rightsToWork: [
          ...kept,
          ...p.rightsToWork.map((r) => ({
            id: current.find((c) => c.country?.countryCode === r.countryCode)?.id ?? randomUUID(),
            countryCode: r.countryCode,
            type2: { id: r.optionId },
          })),
        ],
      },
      ...LZ,
    });
    done.push("rightsToWork");
  }
  if (p.approachable != null) {
    await sgql("UpdateApproachability", { approachability: { approachable: p.approachable } });
    done.push("approachable");
  }
  if (p.visibility) {
    await sgql("UpdateProfileVisibility2", { input: { id: p.visibility }, locale: LOCALE });
    done.push("visibility");
  }
  if (!done.length) throw new Error("Nothing to change: pass at least one preference");
  return { updated: done, now: await profileSections(done) };
}

const AVATAR_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadAvatar(path: string) {
  const type = AVATAR_TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error(`Profile photos must be JPG or PNG; "${basename(path)}" is not`);
  const bytes = await readFile(path);
  const created = (await sgql("CreateProfileAvatar", { locale: LOCALE }))?.createProfileAvatar;
  if (!created?.uploadUrl) throw new Error(`Seek would not start a photo upload: ${created?.error?.message ?? "no upload url"}`);
  const put = await fetch(created.uploadUrl, { method: "PUT", headers: { "content-type": type }, body: bytes });
  if (!put.ok) throw new Error(`Uploading the photo failed with HTTP ${put.status}`);
  for (let i = 0; i < 15; i++) {
    const s = (await sgql("GetProfileAvatarStatus", { avatarId: created.avatarId, locale: LOCALE }, { partialOk: true }))?.viewer?.profileAvatarStatus;
    if (s?.__typename === "ProfileAvatarStatusSuccess") return { avatarId: created.avatarId, ready: true, avatar: (await profileSections(["avatar"]) as any).avatar };
    if (s?.__typename === "ProfileAvatarStatusFailure") throw new Error(`Seek rejected the photo: ${s.error?.title ?? ""} ${s.error?.message ?? ""}`.trim());
    await sleep(2000);
  }
  return { avatarId: created.avatarId, ready: false, note: "Seek is still processing the photo; check seek_profile later." };
}

export async function deleteAvatar() {
  await sgql("DeleteProfileAvatar", {});
  return { deleted: true };
}

export async function generateResume() {
  const d = await sgql("GenerateResumeFromProfile", LZ);
  const r = d?.generateResumeFromProfile?.resume;
  return clean({ resume: r ? { id: r.id, name: r.fileMetadata?.name, isDefault: r.isDefault, created: r.createdDateUtc } : null });
}

export async function resumeDownloadLink(id: string) {
  const d = await sgql("DocumentDownloadLink", { resourceId: id, resumeId: id });
  const link = d?.viewer?.documentDownloadLink?.link;
  if (!link) throw new Error(`Seek returned no download link for résumé ${id}`);
  return { id, name: d?.viewer?.resume?.fileMetadata?.name ?? null, link: link.startsWith("http") ? link : `${ORIGIN}${link}` };
}
