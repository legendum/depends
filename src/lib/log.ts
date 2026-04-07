import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = join(import.meta.dir, "..", "..", "log");
mkdirSync(LOG_DIR, { recursive: true });

/**
 * Append a structured JSON-line entry to today's log file.
 * `ts` is added automatically if not present.
 */
export function log(entry: Record<string, unknown>): void {
  const ts = (entry.ts as string | undefined) ?? new Date().toISOString();
  const date = ts.slice(0, 10);
  appendFileSync(
    join(LOG_DIR, `${date}.log`),
    `${JSON.stringify({ ts, ...entry })}\n`,
  );
}
