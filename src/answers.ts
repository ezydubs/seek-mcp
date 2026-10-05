import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STORE_DIR = process.env.SEEK_TOKEN_DIR ?? join(homedir(), ".seek-mcp");
export const ANSWERS_PATH = join(STORE_DIR, "answers.json");

export interface SalaryBand {

  upTo: number;

  answer: string;
}

export interface StandingAnswers {

  workRights?: { question: string; option: string };
  notice?: { question: string; option: string };
  salary?: { question: string; bands: SalaryBand[]; defaultAnswer: string; hourlyAnswer?: string };
}

export function readAnswers(): StandingAnswers {
  try {
    return JSON.parse(readFileSync(ANSWERS_PATH, "utf8")) as StandingAnswers;
  } catch {
    return {};
  }
}

export function writeAnswers(a: StandingAnswers): string {
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(ANSWERS_PATH, JSON.stringify(a, null, 2));
  chmodSync(ANSWERS_PATH, 0o600);
  return ANSWERS_PATH;
}

export function parseSalary(label: string | null | undefined): { low: number; high: number; unit: "year" | "hour" } | null {
  if (!label) return null;
  const collapsed = label.replace(/(\d)[ \u00a0](\d{3})(?!\d)/g, "$1$2");
  const tokens = [...collapsed.matchAll(/(\d[\d,]*)\s*([km])?/gi)]
    .map((m) => ({ digits: m[1].replace(/,/g, ""), kilo: !!m[2] }))
    .filter((t) => t.digits.length > 0 && Number.isFinite(Number(t.digits)));
  if (!tokens.length) return null;
  const anyKilo = tokens.some((t) => t.kilo);
  const values = tokens.map((t) => {
    const n = Number(t.digits);

    return t.kilo || (anyKilo && !t.digits.includes(",") && n < 1000) ? n * 1000 : n;
  });

  const perHour = /(?:p\s*\/?\s*h(?:r|rs|our|ours)?\b|per\s*hour|hourly|an\s+hour)/i.test(label);
  const unit = perHour ? "hour" : "year";
  return { low: Math.min(...values), high: Math.max(...values), unit };
}

export function pickSalaryBand(
  bands: SalaryBand[],
  advertised: string | null | undefined,
  defaultAnswer: string,
): { answer: string; basis: string } {
  const parsed = parseSalary(advertised);
  if (!parsed) return { answer: defaultAnswer, basis: "no salary advertised" };
  if (parsed.unit === "hour")
    return { answer: defaultAnswer, basis: `advertised ${advertised} is a rate, not a salary` };
  if (!bands.length) return { answer: defaultAnswer, basis: "no salary bands configured" };
  const sorted = [...bands].sort((a, b) => a.upTo - b.upTo);
  const mid = (parsed.low + parsed.high) / 2;
  const chosen = sorted.find((b) => mid <= b.upTo) ?? sorted[sorted.length - 1];
  return { answer: chosen.answer, basis: `advertised ${advertised} (mid $${Math.round(mid / 1000)}k) → ${chosen.answer}` };
}

export function answerAsFigure(answer: string): string | null {
  const m = answer.replace(/[,\s]/g, "").match(/^\$?(\d+(?:\.\d+)?)(k?)$/i);
  if (!m) return null;
  return String(Math.round(Number(m[1]) * (m[2].toLowerCase() === "k" ? 1000 : 1)));
}
