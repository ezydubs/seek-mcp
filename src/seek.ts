import { randomUUID } from "node:crypto";
import { D, type DocumentName } from "./documents.js";

export const ORIGIN = "https://nz.seek.com";
export const CAREER_API = "https://career-guide-api.cloud.seek.com.au/graphql";
export const ZONE = "anz-2";
export const LOCALE = "en-NZ";
export const LANGUAGE = "en";
export const COUNTRY = "NZ";
export const TIMEZONE = "Pacific/Auckland";
export const PLATFORM = "WEB";
export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

export const VISITOR_ID = randomUUID();
export const SESSION_ID = randomUUID();

export const opName = (query: string) => /\b(?:query|mutation)\s+([A-Za-z_]\w*)/.exec(query)?.[1];

export class SeekApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export const SITE_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  accept: "application/graphql-response+json,application/json;q=0.9",
  "seek-request-brand": "seek",
  "seek-request-country": COUNTRY,
  "x-seek-site": "chalice",
  origin: ORIGIN,
  referer: `${ORIGIN}/`,
  "user-agent": UA,
};

export interface GqlBody {
  data?: any;
  errors?: Array<{ message: string; path?: string[]; extensions?: { code?: string } }>;
}

export async function postGraphql(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ status: number; body: GqlBody }> {
  const r = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ operationName: opName(query), variables, query }),
  });
  const text = await r.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SeekApiError(`Seek returned HTTP ${r.status} that was not JSON: ${text.slice(0, 200)}`);
  }
  if (Array.isArray(body)) body = body[0];
  if (!r.ok && !body?.errors) throw new SeekApiError(`Seek returned HTTP ${r.status}: ${text.slice(0, 300)}`);
  return { status: r.status, body };
}

export function unwrap(body: GqlBody, what: string, partialOk = false): any {
  const errors = body.errors ?? [];
  if (errors.length && (!partialOk || body.data == null)) {
    const e = errors[0];
    throw new SeekApiError(`Seek (${what}): ${e.message}${e.extensions?.code ? ` [${e.extensions.code}]` : ""}`, e.extensions?.code);
  }
  return body.data;
}

const UNSTABLE_FIELD_OPERATIONS = new Set([
  "jobDetailsPersonalised", "CandidateJobMatch", "createCandidateJobMatchRequest", "CandidateJobMatchStrongFit",
  "createCandidateJobMatchStrongFitRequest", "CandidateJobMatchStandOut", "createCandidateJobMatchStandOutRequest",
  "GetCareerFeed", "CareerFeedJobsNextBestQuestion", "SubmitCareerFeedJobsRefinement", "GetCareerFeedRecsRefinementStatus",
  "CareerFeedProfilePerformanceInsightsSummary", "GetJobSearchAssist", "GetGraduatesTabData",
]);

export const featureHeaders = (operationName?: string): Record<string, string> =>
  operationName && UNSTABLE_FIELD_OPERATIONS.has(operationName) ? { "x-custom-features": "application/features.seek.all+json" } : {};

export async function publicGql(name: DocumentName, variables: Record<string, unknown> = {}, opts: { partialOk?: boolean; headers?: Record<string, string> } = {}) {
  const { body } = await postGraphql(`${ORIGIN}/graphql`, D[name], variables, { ...SITE_HEADERS, ...featureHeaders(name), ...opts.headers });
  return unwrap(body, name, opts.partialOk);
}

export async function careerGql(name: DocumentName, variables: Record<string, unknown> = {}, opts: { partialOk?: boolean } = {}) {
  const { body } = await postGraphql(CAREER_API, D[name], variables, {
    ...SITE_HEADERS,
    "x-seek-site": "skl-career-guide-site",
    country: COUNTRY,
    language: LANGUAGE,
    "apollographql-client-name": "Career advice site",
  });
  return unwrap(body, name, opts.partialOk);
}

export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean).filter((x) => !isEmpty(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "__typename") continue;
      const c = clean(x);
      if (!isEmpty(c)) out[k] = c;
    }
    return out as T;
  }
  return v;
}
const isEmpty = (x: unknown) =>
  x == null || x === "" || (Array.isArray(x) && x.length === 0) || (typeof x === "object" && !Array.isArray(x) && Object.keys(x as object).length === 0);

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|h[1-6]|ul|ol)\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function assertJobId(id: string): string {
  const jobId = String(id).trim();
  if (!/^\d+$/.test(jobId)) throw new Error(`Seek job ids are numeric; got "${jobId}"`);
  return jobId;
}

export const ontology = (text: string, ontologyId?: string | null) => ({ text, ontologyId: ontologyId ?? null });
