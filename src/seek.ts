// Seek (nz.seek.com) through one long-lived CloakBrowser profile.
// Search uses Seek's public jobsearch API, called from inside the page like the site does.
// Job ads come from the job page's server-rendered Apollo data. Saved/applied jobs come from the
// site's own GraphQL responses on the My Activity pages, so Seek's page handles its own auth token.
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { launchPersistentContext } from "cloakbrowser";
import type { BrowserContext, Page, Response } from "playwright-core";
import { readChromeCookies } from "./chrome-cookies.js";

export const ORIGIN = "https://nz.seek.com";
const PROFILE_DIR = process.env.SEEK_PROFILE_DIR ?? join(homedir(), ".cloakbrowser-profiles", "seek");
// A one-time hand-over of Seek's Auth0 sign-in (its localStorage entries, incl. the refresh token).
// Seek keeps the session there, not in cookies, so copied Chrome cookies alone land on login.seek.com.
// The file is deleted once imported: Auth0 rotates the refresh token, so only one profile may hold it.
const AUTH_HANDOVER = process.env.SEEK_AUTH_FILE ?? join(homedir(), ".cloakbrowser-profiles", "seek-auth.json");
const COOKIE_SITES = ["seek.com", "seek.co.nz"];
const IDLE_CLOSE_MS = 5 * 60_000;

export class NotLoggedInError extends Error {}

const log = (...a: unknown[]) => console.error("[seek-mcp]", ...a);

export class SeekBrowser {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;

  /** Run one operation at a time on the shared page. */
  run<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      try {
        return await fn(await this.ensurePage());
      } finally {
        this.idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
        this.idleTimer.unref();
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.context) {
      mkdirSync(PROFILE_DIR, { recursive: true });
      this.context = await launchPersistentContext({
        userDataDir: PROFILE_DIR,
        headless: true,
        locale: "en-NZ",
        timezone: "Pacific/Auckland",
      });
      this.context.on("close", () => {
        this.context = null;
        this.page = null;
      });
      await this.refreshCookies();
    }
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    await this.importAuthHandover(this.page);
    return this.page;
  }

  /** Copy the user's current Chrome cookies for Seek into this profile. */
  async refreshCookies(): Promise<number> {
    if (!this.context) return 0;
    try {
      const cookies = readChromeCookies(COOKIE_SITES);
      await this.context.addCookies(cookies);
      log(`loaded ${cookies.length} Seek cookies from Chrome`);
      return cookies.length;
    } catch (e) {
      log("could not read Chrome cookies, continuing with the profile's own:", (e as Error).message);
      return 0;
    }
  }

  private async importAuthHandover(page: Page): Promise<void> {
    if (!existsSync(AUTH_HANDOVER)) return;
    const { origin, localStorage: entries } = JSON.parse(readFileSync(AUTH_HANDOVER, "utf8")) as {
      origin: string;
      localStorage: Record<string, string>;
    };
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((items) => {
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    }, entries);
    rmSync(AUTH_HANDOVER, { force: true });
    log(`imported Seek sign-in (${Object.keys(entries).length} entries) and removed the hand-over file`);
  }

  async close(): Promise<void> {
    const ctx = this.context;
    this.context = null;
    this.page = null;
    if (ctx) await ctx.close().catch(() => undefined);
  }
}

/** Make sure the page sits on nz.seek.com so same-origin fetches carry Seek's cookies. */
async function onSeek(page: Page): Promise<void> {
  if (!page.url().startsWith(ORIGIN)) await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
}

// ---------- search ----------

export interface SearchParams {
  keywords?: string;
  where?: string;
  page?: number;
  pageSize?: number;
  sort?: "relevance" | "newest";
  workType?: Array<"full_time" | "part_time" | "contract" | "casual">;
  listedWithinDays?: 1 | 3 | 7 | 14 | 31;
  salaryMin?: number;
  salaryMax?: number;
  salaryType?: "annual" | "hourly";
}

const WORK_TYPE_IDS = { full_time: 242, part_time: 243, contract: 244, casual: 245 } as const;

export async function search(page: Page, p: SearchParams) {
  await onSeek(page);
  const q: Record<string, string> = {
    siteKey: "NZ-Main",
    locale: "en-NZ",
    page: String(p.page ?? 1),
    pageSize: String(p.pageSize ?? 20),
    sortmode: p.sort === "newest" ? "ListedDate" : "KeywordRelevance",
  };
  if (p.keywords) q.keywords = p.keywords;
  if (p.where) q.where = p.where;
  if (p.workType?.length) q.worktype = p.workType.map((w) => WORK_TYPE_IDS[w]).join(",");
  if (p.listedWithinDays) q.daterange = String(p.listedWithinDays);
  if (p.salaryMin != null || p.salaryMax != null) {
    q.salaryrange = `${p.salaryMin ?? 0}-${p.salaryMax ?? ""}`;
    q.salarytype = p.salaryType ?? "annual";
  }
  const data = await page.evaluate(async (params) => {
    const u = new URL("/api/jobsearch/v5/search", location.origin);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u, { credentials: "include", headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`Seek search returned HTTP ${r.status}`);
    return r.json();
  }, q);
  type Raw = {
    id: string; title: string; companyName?: string; advertiser?: { description?: string };
    locations?: { label: string }[]; salaryLabel?: string; workTypes?: string[];
    workArrangements?: { displayText?: string }; listingDate?: string; listingDateDisplay?: string;
    teaser?: string; bulletPoints?: string[]; classifications?: { subclassification?: { description?: string } }[];
    isFeatured?: boolean; displayType?: string;
  };
  return {
    total: data.totalCount as number,
    page: Number(q.page),
    jobs: ((data.data ?? []) as Raw[]).map((j) => ({
      id: j.id,
      title: j.title,
      company: j.companyName ?? j.advertiser?.description ?? null,
      location: j.locations?.map((l) => l.label).join("; ") || null,
      salary: j.salaryLabel || null,
      workType: j.workTypes?.join(", ") || null,
      arrangement: j.workArrangements?.displayText || null,
      category: j.classifications?.[0]?.subclassification?.description ?? null,
      listed: j.listingDate ?? null,
      listedAgo: j.listingDateDisplay ?? null,
      // Paid placements Seek pins above the sorted results.
      promoted: j.isFeatured || j.displayType === "promoted" || undefined,
      teaser: j.teaser || null,
      bullets: j.bulletPoints?.length ? j.bulletPoints : undefined,
      url: `${ORIGIN}/job/${j.id}`,
    })),
  };
}

// ---------- job details ----------

export async function job(page: Page, id: string) {
  if (!/^\d+$/.test(id)) throw new Error(`Seek job ids are numeric; got "${id}"`);
  const resp = await page.goto(`${ORIGIN}/job/${id}`, { waitUntil: "domcontentloaded" });
  if (resp && resp.status() === 404) throw new Error(`Seek has no job ${id} (404)`);
  return page.evaluate((jobId) => {
    const c = (window as unknown as { SEEK_APOLLO_DATA?: Record<string, any> }).SEEK_APOLLO_DATA;
    if (!c) throw new Error("Job page loaded without Seek's job data");
    const deref = (v: any): any => (v && v.__ref ? c[v.__ref] : v);
    const field = (o: any, name: string): any => {
      if (!o) return undefined;
      if (name in o) return deref(o[name]);
      const k = Object.keys(o).find((key) => key.startsWith(`${name}(`));
      return k ? deref(o[k]) : undefined;
    };
    const jd = c.ROOT_QUERY?.[`jobDetails:{"id":"${jobId}"}`];
    if (!jd) throw new Error(`No details for job ${jobId} in the page (expired or removed?)`);
    const j = deref(jd.job);
    const html: string = field(j, "content2") ?? field(j, "content") ?? "";
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;left:-99999px;white-space:normal";
    box.innerHTML = html;
    box.querySelectorAll("li").forEach((li) => li.prepend("• "));
    document.body.append(box);
    const text = box.innerText.replace(/\n{3,}/g, "\n\n").trim();
    box.remove();
    const adv = deref(j.advertiser);
    const salary = deref(j.salary);
    const cls = (j.classifications ?? []).map(deref).map((x: any) => field(x, "label")).filter(Boolean);
    return {
      id: j.id,
      title: j.title,
      company: field(adv, "name") ?? null,
      advertiserVerified: adv?.isVerified ?? null,
      location: field(deref(j.location), "label") ?? null,
      salary: salary ? (field(salary, "label") ?? null) : null,
      workType: field(deref(j.workTypes), "label") ?? null,
      category: cls.join("; ") || null,
      listed: deref(j.listedAt)?.dateTimeUtc ?? null,
      listedLabel: field(deref(j.listedAt), "label") ?? null,
      expiresAt: deref(j.expiresAt)?.dateTimeUtc ?? null,
      status: j.status ?? null,
      expired: j.isExpired ?? null,
      externalApply: j.isLinkOut ?? null,
      abstract: j.abstract ?? null,
      description: text,
      url: `${location.origin}/job/${j.id}`,
    };
  }, id);
}

// ---------- logged-in lists ----------

function graphqlOp(op: string) {
  return (r: Response) => {
    if (!r.url().endsWith("/graphql") || r.request().method() !== "POST") return false;
    try {
      return JSON.parse(r.request().postData() ?? "{}").operationName === op;
    } catch {
      return false;
    }
  };
}

/** Open a My Activity page and return the body of the named GraphQL query it makes. */
async function activityQuery(page: Page, path: string, op: string): Promise<any> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const wait = page.waitForResponse(graphqlOp(op), { timeout: 25_000 });
    await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
    try {
      const resp = await wait;
      const body = await resp.json();
      if (body?.errors?.length && !body.data?.viewer) throw new NotLoggedInError(body.errors[0].message);
      return body;
    } catch (e) {
      if (new URL(page.url()).hostname === "login.seek.com") {
        throw new NotLoggedInError("Seek wants a login. Log into Seek in Chrome, then try again.");
      }
      // First visit may bounce through Seek's OAuth refresh to another page; go back once.
      if (attempt === 2) throw e;
    }
  }
}

const iso = (d: any) => d?.dateTimeUtc ?? null;

export async function savedJobs(page: Page) {
  const body = await activityQuery(page, "/my-activity/saved-jobs", "GetSavedJobs");
  const edges = body.data.viewer.savedJobs.edges as any[];
  return edges.map(({ node: n }) => ({
    id: n.job.id,
    title: n.job.title,
    company: n.job.advertiser?.name ?? null,
    location: n.job.location?.label ?? null,
    salary: n.job.salary?.label ?? null,
    listed: iso(n.job.listedAt),
    savedAt: iso(n.createdAt),
    stillOpen: n.isActive,
    externalApply: n.isExternal,
    notes: n.notes ?? null,
    abstract: n.job.abstract ?? null,
    url: `${ORIGIN}/job/${n.job.id}`,
  }));
}

export async function appliedJobs(page: Page) {
  const body = await activityQuery(page, "/my-activity/applied-jobs", "GetAppliedJobs");
  const edges = body.data.viewer.appliedJobs.edges as any[];
  return edges.map(({ node: n }) => ({
    id: n.job.id,
    title: n.job.title,
    company: n.job.advertiser?.name ?? null,
    location: n.job.location?.label ?? null,
    salary: n.job.salary?.label ?? null,
    appliedAt: iso(n.appliedAt),
    stillOpen: n.isActive,
    externalApply: n.isExternal,
    withResume: n.hasAppliedWithResume,
    withCoverLetter: n.hasAppliedWithCoverLetter,
    status: n.events?.length ? n.events[n.events.length - 1].status : null,
    history: (n.events ?? []).map((e: any) => ({ status: e.status, at: iso(e.timestamp) ?? e.timestamp })),
    notes: n.notes ?? null,
    url: `${ORIGIN}/job/${n.job.id}`,
  }));
}
