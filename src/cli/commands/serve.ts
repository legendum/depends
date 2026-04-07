import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseCliArgs } from "../lib/config";

export async function cmdServe(args: string[]) {
  const { values } = parseCliArgs(args);
  const port =
    typeof values.port === "string" ? parseInt(values.port, 10) : 3000;

  const { createDb } = await import("../../db");
  const { createServer } = await import("../../server");

  const dbPath = join(process.cwd(), "data", "depends.db");
  if (!existsSync(join(process.cwd(), "data"))) {
    mkdirSync(join(process.cwd(), "data"), { recursive: true });
  }

  const db = createDb(dbPath);
  const server = createServer(db, port);

  console.log(`depends.cc listening on http://localhost:${server.port}`);
  console.log(`Use token "dep_local" — no signup needed.`);
  console.log(`\nSet your CLI to use this server:`);
  console.log(`  export DEPENDS_API_URL=http://localhost:${server.port}/v1`);
}
