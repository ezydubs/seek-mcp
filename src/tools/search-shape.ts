import { z } from "zod";
import type { SearchParams } from "../api.js";

export const searchFilterShape = {
  keywords: z.string().optional().describe('What to search for, e.g. "software engineer"'),
  where: z.string().optional().describe('Place, e.g. "All Auckland", "Wellington", "Christchurch"'),
  workType: z.array(z.enum(["full_time", "part_time", "contract", "casual"])).optional(),
  workArrangement: z.array(z.enum(["on_site", "hybrid", "remote"])).optional(),
  classification: z.array(z.number().int()).optional().describe("Classification ids (seek_classifications), e.g. [1200] Accounting"),
  subclassification: z.array(z.number().int()).optional().describe("Subclassification ids (seek_classifications)"),
  listedWithinDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(31)]).optional(),
  salaryMin: z.number().int().min(0).optional(),
  salaryMax: z.number().int().min(0).optional(),
  salaryType: z.enum(["annual", "hourly"]).optional().describe("Units for salaryMin/Max, default annual"),
  advertiserId: z.string().optional().describe("One advertiser account's jobs (advertiserId from seek_search/seek_job)"),
  companyId: z.string().optional().describe("A company's organisation id (organisationId from seek_company): all its jobs"),
};

export const toSearchParams = (a: Record<string, any>): SearchParams => ({
  keywords: a.keywords,
  where: a.where,
  workType: a.workType,
  workArrangement: a.workArrangement,
  classification: a.classification,
  subclassification: a.subclassification,
  listedWithinDays: a.listedWithinDays,
  salaryMin: a.salaryMin,
  salaryMax: a.salaryMax,
  salaryType: a.salaryType,
  advertiserId: a.advertiserId,
  companyId: a.companyId,
  page: a.page,
  pageSize: a.pageSize,
  sort: a.sort,
});
