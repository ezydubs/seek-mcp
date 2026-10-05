import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { ORIGIN, gql } from "./auth.js";
import { answerAsFigure, pickSalaryBand, type StandingAnswers } from "./answers.js";

const ZONE = "anz-2";
const LOCALE = "en-NZ";

const UPDATE_PERSONAL = `mutation UpdatePersonalDetails($personalDetailsInput: UpdatePersonalDetailsInput!, $currentLocationInput: UpdateCurrentLocation2Input!, $zone: Zone!) {
  updatePersonalDetails(input: $personalDetailsInput) { viewer { _id emailAddress personalDetails { firstName lastName phoneNumber countryCallingCode { id countryCallingCode } } } }
  updateCurrentLocation2(input: $currentLocationInput) {
    ... on UpdateCurrentLocation2Success { viewer { _id currentLocation2(zone: $zone) { id description countryCode kind } } }
    ... on UpdateCurrentLocation2Failure { error { message } }
  }
}`;

export interface PersonalDetails {
  firstName: string;
  lastName: string;
  phoneNumber: string;

  countryCallingCodeId?: string;

  locationId?: number;
}

export async function updatePersonalDetails(d: PersonalDetails) {
  return gql(UPDATE_PERSONAL, {
    personalDetailsInput: {
      firstName: d.firstName,
      lastName: d.lastName,
      phoneNumber: d.phoneNumber.replace(/^[+\s()-]+/, ""),
      countryCallingCode: { id: d.countryCallingCodeId ?? "159" },
    },
    currentLocationInput: { currentLocation: { id: d.locationId ?? 30010 } },
    zone: ZONE,
  });
}

const UPDATE_ROLE = `mutation UpdateRole($role: UpdateRoleInput!) {
  updateRole(input: $role) {
    viewer { _id roles(status: confirmed) {
      id title { text } company { text } from { year month } to { year month } achievements
    } }
  }
}`;

export interface RoleInput {

  id?: string;
  title: string;
  company: string;
  from: { year: number; month: number };
  to?: { year: number; month: number } | null;
  achievements?: string;
}

export async function upsertRole(role: RoleInput) {
  return gql(UPDATE_ROLE, {
    role: {
      id: role.id ?? randomUUID(),
      title: { text: role.title, ontologyId: null },
      company: { text: role.company, ontologyId: null },
      from: { month: role.from.month, year: role.from.year },
      to: role.to ? { month: role.to.month, year: role.to.year } : null,
      achievements: role.achievements ?? null,
      seniority: null,
    },
  });
}

const RESUME_FRAGMENT = `fragment resume on Resume {
  id createdDateUtc isDefault
  fileMetadata { name size virusScanStatus sensitiveDataInfo { isDetected } uri }
  origin { type }
}`;

const UPLOAD_FORM = `query GetDocumentUploadData($id: UUID!) {
  viewer { documentUploadFormData(id: $id) { link key formFields { key value } } }
}`;

const PROCESS_RESUME = `mutation ApplyProcessUploadedResume($input: ProcessUploadedResumeInput!) {
  processUploadedResume(input: $input) { resume { ...resume } viewer { _id resumes { ...resume } } }
}
${RESUME_FRAGMENT}`;

const ATTACHMENT_STATUS = `query GetAttachmentMetadata($blobUrl: String!) {
  viewer { _id attachmentMetadata(blobUrl: $blobUrl) { fileName virusScanStatus } }
}`;

const PARSE_RESUME = `mutation RequestResumeParsing($input: RequestResumeParsingInput!) {
  requestResumeParsing(input: $input) { ref }
}`;

const SET_DEFAULT_RESUME = `mutation SetDefaultResume($resumeId: SetDefaultResumeInput!, $languageCode: LanguageCodeIso!) {
  setDefaultResume(input: $resumeId) { viewer { _id resumes(languageCode: $languageCode) { ...resume } } }
}
${RESUME_FRAGMENT}`;

const DELETE_RESUME = `mutation DeleteResume($input: DeleteResumeInput!) {
  deleteResume(input: $input) { viewer { _id resumes { ...resume } } }
}
${RESUME_FRAGMENT}`;

const RESUME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
};

export interface ResumeSummary {
  id: string;
  name: string | null;
  size: string | null;
  virusScanStatus: string | null;
  isDefault: boolean;
  uri: string | null;
  createdAt: string | null;
}

const summariseResume = (r: any): ResumeSummary => ({
  id: r.id,
  name: r.fileMetadata?.name ?? null,
  size: r.fileMetadata?.size ?? null,
  virusScanStatus: r.fileMetadata?.virusScanStatus ?? null,
  isDefault: !!r.isDefault,
  uri: r.fileMetadata?.uri ?? null,
  createdAt: r.createdDateUtc ?? null,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadResume(path: string, opts: { makeDefault?: boolean } = {}) {
  const ext = extname(path).toLowerCase();
  const type = RESUME_TYPES[ext];
  if (!type) {
    throw new Error(`Seek accepts PDF, DOC, DOCX, TXT or RTF résumés; "${basename(path)}" has ${ext ? `the extension ${ext}` : "no extension"}`);
  }
  const bytes = await readFile(path);
  const id = randomUUID();

  const form = (await gql(UPLOAD_FORM, { id })).viewer?.documentUploadFormData;
  if (!form?.link || !Array.isArray(form.formFields)) throw new Error("Seek did not return an upload form for the résumé");
  const body = new FormData();
  for (const f of form.formFields as Array<{ key: string; value: string }>) body.append(f.key, f.value);
  body.append("file", new Blob([bytes], { type }), basename(path));
  const upload = await fetch(form.link, { method: "POST", body });
  if (!upload.ok) throw new Error(`Uploading the résumé failed with HTTP ${upload.status}: ${(await upload.text()).slice(0, 300)}`);

  const processed = await gql(PROCESS_RESUME, { input: { id, parsingContext: { id: randomUUID() }, zone: ZONE } });
  const registered = processed.processUploadedResume?.resume;
  if (!registered?.id) throw new Error("Seek stored the file but did not register it as a résumé");

  const uri = registered.fileMetadata?.uri ?? `/v2/blobstore/resumes/${id}/`;
  let status: string = registered.fileMetadata?.virusScanStatus ?? "Pending";
  for (let i = 0; status === "Pending" && i < 30; i++) {
    await sleep(2000);
    const meta = (await gql(ATTACHMENT_STATUS, { blobUrl: uri })).viewer?.attachmentMetadata;
    status = meta?.virusScanStatus ?? status;
  }
  if (status !== "OK" && status !== "Pending") {
    throw new Error(`Seek's virus scan reported "${status}" for ${basename(path)}; the résumé cannot be used`);
  }

  await gql(PARSE_RESUME, { input: { id, parsingContext: { id }, zone: ZONE } }).catch(() => undefined);

  let resumes: ResumeSummary[] = (processed.processUploadedResume?.viewer?.resumes ?? []).map(summariseResume);
  if (opts.makeDefault ?? true) resumes = (await setDefaultResume(id)).resumes;
  resumes = resumes.map((r) => (r.id === id ? { ...r, virusScanStatus: status } : r));
  const mine = resumes.find((r) => r.id === id) ?? summariseResume(registered);
  return {
    resume: { ...mine, virusScanStatus: status },
    scanned: status === "OK",
    note: status === "Pending" ? "Seek is still scanning the file; check seek_profile before applying with it." : undefined,
    resumes,
  };
}

export async function setDefaultResume(id: string) {
  const data = await gql(SET_DEFAULT_RESUME, { resumeId: { id }, languageCode: "en" });
  return { defaultId: id, resumes: ((data.setDefaultResume?.viewer?.resumes ?? []) as any[]).map(summariseResume) };
}

export async function deleteResume(id: string) {
  const data = await gql(DELETE_RESUME, { input: { id } });
  return { deleted: id, resumes: ((data.deleteResume?.viewer?.resumes ?? []) as any[]).map(summariseResume) };
}

const SAVE_JOB = `mutation CreateSavedJob($input: CreateSavedJobInput!, $locale: Locale) {
  createSavedJob2(input: $input) {
    ... on CreateSavedJobSuccess { id }
    ... on CreateSavedJobFailure { errors { message(locale: $locale) } }
  }
}`;

const UNSAVE_JOB = `mutation DeleteSavedJob($input: DeleteSavedJobInput!, $locale: Locale) {
  deleteSavedJob2(input: $input) {
    ... on DeleteSavedJobSuccess { id }
    ... on DeleteSavedJobFailure { errors { message(locale: $locale) } }
  }
}`;

function assertJobId(jobId: string) {
  if (!/^\d+$/.test(jobId)) throw new Error(`Seek job ids are numeric; got "${jobId}"`);
}

export async function saveJob(jobId: string) {
  assertJobId(jobId);
  const r = (await gql(SAVE_JOB, { input: { id: jobId, zone: ZONE }, locale: LOCALE })).createSavedJob2;
  if (r?.errors?.length) throw new Error(`Seek would not save job ${jobId}: ${r.errors[0].message}`);
  return { jobId, saved: true, url: `${ORIGIN}/job/${jobId}` };
}

export async function unsaveJob(jobId: string) {
  assertJobId(jobId);
  const r = (await gql(UNSAVE_JOB, { input: { id: jobId }, locale: LOCALE })).deleteSavedJob2;
  if (r?.errors?.length) throw new Error(`Seek would not unsave job ${jobId}: ${r.errors[0].message}`);
  return { jobId, saved: false, url: `${ORIGIN}/job/${jobId}` };
}

export interface WantedAnswer {

  question: string;

  option?: string | string[];

  text?: string;
}

const decode = (s: string) =>
  s
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");

const fold = (s: string) => decode(s).toLowerCase().replace(/\s+/g, " ").trim();

interface QuestionLike {
  id: string;
  text: string | null;
  kind: string;
  options: Array<{ id: string; text: string; uri: string | null }>;
}

const questionFor = (questions: QuestionLike[], fragment: string) =>
  questions.find((c) => fold(c.text ?? "").includes(fold(fragment)));

export function fillStandingAnswers(
  questions: QuestionLike[],
  wanted: WantedAnswer[],
  standing: StandingAnswers,
  advertisedSalary: string | null | undefined,
): { wanted: WantedAnswer[]; autoFilled: Array<{ question: string; answer: string; basis: string }> } {
  const out = [...wanted];
  const autoFilled: Array<{ question: string; answer: string; basis: string }> = [];
  const covered = (q: QuestionLike) => out.some((w) => questionFor(questions, w.question)?.id === q.id);

  if (standing.workRights) {
    const q = questionFor(questions, "right to work");
    if (q && !covered(q)) {
      out.push({ question: q.text ?? "", option: standing.workRights.option });
      autoFilled.push({ question: q.text ?? "", answer: standing.workRights.option, basis: "standing answer" });
    }
  }
  if (standing.notice) {
    const q = questionFor(questions, "notice");
    if (q && !covered(q)) {
      out.push({ question: q.text ?? "", option: standing.notice.option });
      autoFilled.push({ question: q.text ?? "", answer: standing.notice.option, basis: "standing answer" });
    }
  }
  if (standing.salary) {
    for (const [fragment, hourly] of [["salary", false], ["hourly", true]] as const) {
      const q = questionFor(questions, fragment);
      if (!q || covered(q)) continue;
      const pick = pickSalaryBand(standing.salary.bands, advertisedSalary, standing.salary.defaultAnswer);
      const text = q.kind === "FreeTextQuestion"
        ? hourly ? standing.salary.hourlyAnswer : answerAsFigure(pick.answer)
        : pick.answer;
      if (!text) continue;
      out.push(q.kind === "FreeTextQuestion" ? { question: q.text ?? "", text } : { question: q.text ?? "", option: pick.answer });
      autoFilled.push({ question: q.text ?? "", answer: text, basis: pick.basis });
    }
  }
  return { wanted: out, autoFilled };
}

export async function resolveAnswers(process: { questions: QuestionLike[] }, wanted: WantedAnswer[]): Promise<Answer[]> {
  const out: Answer[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const w of wanted) {
    const q = questionFor(process.questions, w.question);
    if (!q) {
      problems.push(`no question matching "${w.question}"`);
      continue;
    }
    if (seen.has(q.id)) {
      problems.push(`two answers given for "${q.text}" — keep one`);
      continue;
    }
    seen.add(q.id);

    if (q.kind === "FreeTextQuestion") {
      const text = (w.text ?? "").trim();
      if (!text) {
        problems.push(`"${q.text}" needs a "text" answer`);
        continue;
      }
      out.push({ questionId: q.id, answers: [{ text }] });
      continue;
    }

    const requested = w.option == null ? [] : Array.isArray(w.option) ? w.option : [w.option];
    if (!requested.length) {
      problems.push(`no option given for "${q.text}"`);
      continue;
    }
    const chosen: Answer["answers"] = [];
    for (const opt of requested) {
      const hits = q.options.filter((o) => fold(o.text).includes(fold(opt)));
      if (hits.length === 0) {
        problems.push(`"${opt}" is not an option for "${q.text}" (options: ${q.options.map((o) => o.text).join(" | ")})`);
        continue;
      }
      if (hits.length > 1) {
        problems.push(`"${opt}" matches ${hits.length} options for "${q.text}": ${hits.map((o) => o.text).join(" | ")} — be more specific`);
        continue;
      }
      const hit = hits[0];
      chosen.push({ id: hit.id, text: hit.text, uri: hit.uri });
    }
    if (chosen.length) out.push({ questionId: q.id, answers: chosen });
  }

  const answered = new Set(out.map((a) => a.questionId));
  const unanswered = process.questions.filter((q) => !answered.has(q.id)).map((q) => q.text);
  if (unanswered.length) problems.push(`no answer given for: ${unanswered.join(" | ")}`);
  if (problems.length) throw new Error(`Cannot build the answers:\n- ${problems.join("\n- ")}`);
  return out;
}

const TRACK_STARTED = `mutation TrackJobApplicationStarted($input: TrackJobApplicationStartedInput!) {
  trackJobApplicationStarted(input: $input) { eventId }
}`;

const GENERATE_COVER_LETTER = `mutation WrittenCoverLetter($input: GenerateCoverLetterInput!) {
  generateCoverLetter(input: $input) {
    ... on GenerateCoverLetterSuccess { uri }
    ... on GenerateCoverLetterFailure { errors { message } }
  }
}`;

const GENERATE_SELECTION_CRITERIA = `mutation WrittenSelectionCriteria($input: GenerateSelectionCriteriaInput!) {
  generateSelectionCriteria(input: $input) {
    ... on GenerateSelectionCriteriaSuccess { uri }
    ... on GenerateSelectionCriteriaFailure { errors { message } }
  }
}`;

const SUBMIT = `mutation ApplySubmitApplication($input: SubmitApplicationInput!, $locale: Locale) {
  submitApplication(input: $input) {
    ... on SubmitApplicationSuccess { applicationId }
    ... on SubmitApplicationFailure { errors { message(locale: $locale) } }
  }
}`;

export interface Answer {
  questionId: string;

  answers: Array<{ id?: string; text: string; uri?: string | null }>;
}

export interface MostRecentRole {
  company: string;
  title: string;
  started: { year: number; month: number };

  finished?: { year: number; month: number } | null;
}

export interface SubmitInput {
  jobId: string;

  resumeId?: string | null;
  coverLetterText?: string | null;

  selectionCriteriaText?: string | null;

  questionnaireAnswers?: Answer[];

  mostRecentRole?: MostRecentRole | null;
  profilePrivacyLevel?: "Public" | "Private";
}

export interface ApplyPreflight {
  correlationId: string;
  resume: { id: string; uri: string } | null;
  coverLetterUri: string | null;
  selectionCriteriaUri: string | null;
}

export function buildSubmitPayload(p: {
  jobId: string;
  correlationId: string;
  resume: { id: string; uri: string } | null;
  coverLetterText?: string | null;
  coverLetterUri: string | null;
  selectionCriteriaText?: string | null;
  selectionCriteriaUri: string | null;
  questionnaireAnswers?: Answer[];
  mostRecentRole?: MostRecentRole | null;
  profilePrivacyLevel?: "Public" | "Private";
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    jobId: p.jobId,
    correlationId: p.correlationId,
    zone: ZONE,
    profilePrivacyLevel: p.profilePrivacyLevel ?? "Public",
  };
  if (p.resume) payload.resume = { id: p.resume.id, uri: p.resume.uri, idFromResumeResource: -1 };
  if (p.coverLetterText && p.coverLetterUri) payload.coverLetter = { writtenText: p.coverLetterText, uri: p.coverLetterUri };
  if (p.selectionCriteriaText && p.selectionCriteriaUri) {
    payload.selectionCriteria = { writtenText: p.selectionCriteriaText, uri: p.selectionCriteriaUri };
  }
  if (p.mostRecentRole) {
    const r = p.mostRecentRole;
    payload.mostRecentRole = { company: r.company, title: r.title, started: r.started, ...(r.finished ? { finished: r.finished } : {}) };
  }
  if (p.questionnaireAnswers?.length) payload.questionnaireAnswers = p.questionnaireAnswers;
  payload.priorityApply = { state: "NotPrioritized" };
  return payload;
}

async function generateDocument(mutation: string, field: string, writtenText: string, what: string): Promise<string> {
  const result = (await gql(mutation, { input: { writtenText } }))[field];
  if (result?.errors?.length) throw new Error(`Seek rejected the ${what}: ${result.errors[0].message}`);
  if (!result?.uri) throw new Error(`Seek did not return a ${what} uri`);
  return result.uri;
}

export async function prepareApplication(input: SubmitInput): Promise<ApplyPreflight> {
  const correlationId = randomUUID();
  await gql(TRACK_STARTED, {
    input: {
      jobId: input.jobId,
      sessionId: randomUUID(),
      applicationCorrelationId: correlationId,
      isProfileApply: true,
    },
  });

  const resume = input.resumeId ? { id: input.resumeId, uri: `/v2/blobstore/resumes/${input.resumeId}/` } : null;
  const coverLetterUri = input.coverLetterText
    ? await generateDocument(GENERATE_COVER_LETTER, "generateCoverLetter", input.coverLetterText, "cover letter")
    : null;
  const selectionCriteriaUri = input.selectionCriteriaText
    ? await generateDocument(GENERATE_SELECTION_CRITERIA, "generateSelectionCriteria", input.selectionCriteriaText, "selection criteria")
    : null;

  return { correlationId, resume, coverLetterUri, selectionCriteriaUri };
}

export async function submitApplication(input: SubmitInput, preflight?: ApplyPreflight) {
  const pre = preflight ?? (await prepareApplication(input));
  const payload = buildSubmitPayload({
    jobId: input.jobId,
    correlationId: pre.correlationId,
    resume: pre.resume,
    coverLetterText: input.coverLetterText,
    coverLetterUri: pre.coverLetterUri,
    selectionCriteriaText: input.selectionCriteriaText,
    selectionCriteriaUri: pre.selectionCriteriaUri,
    questionnaireAnswers: input.questionnaireAnswers,
    mostRecentRole: input.mostRecentRole,
    profilePrivacyLevel: input.profilePrivacyLevel,
  });

  const data = await gql(SUBMIT, { locale: LOCALE, input: payload });
  const result = data.submitApplication;
  if (result?.errors?.length) throw new Error(`Seek rejected the application: ${result.errors[0].message}`);
  if (!result?.applicationId) throw new Error("Seek accepted the request but returned no application id");
  return { applicationId: result.applicationId, url: `${ORIGIN}/job/${input.jobId}` };
}
