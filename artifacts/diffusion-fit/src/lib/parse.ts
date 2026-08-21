import Papa from "papaparse";
import type { Point } from "./fit";

export type ParseResult = {
  points: Point[];
  warnings: string[];
};

const headerRegex = /[a-zA-Z]/;

export function parseDataset(raw: string): ParseResult {
  const text = raw.trim();
  if (!text) return { points: [], warnings: [] };

  const normalized = text.replace(/\t/g, ",");
  const parsed = Papa.parse<string[]>(normalized, {
    skipEmptyLines: "greedy",
    delimiter: "",
    delimitersToGuess: [",", ";", "\t", " "],
  });

  const warnings: string[] = [];
  const points: Point[] = [];

  let rows = parsed.data as string[][];
  if (rows.length === 0) return { points, warnings };

  const first = rows[0];
  if (first && first.some((c) => headerRegex.test(c ?? ""))) {
    rows = rows.slice(1);
  }

  rows.forEach((row, idx) => {
    if (!row || row.length < 2) return;
    const t = Number(String(row[0]).trim());
    const u = Number(String(row[1]).trim());
    if (!Number.isFinite(t) || !Number.isFinite(u)) {
      warnings.push(`Skipped row ${idx + 1}: could not parse "${row.join(",")}"`);
      return;
    }
    points.push({ t, U: u });
  });

  points.sort((a, b) => a.t - b.t);
  return { points, warnings };
}

export function pointsToCsv(points: Point[]): string {
  const head = "t,U";
  const body = points.map((p) => `${p.t},${p.U}`).join("\n");
  return `${head}\n${body}\n`;
}
