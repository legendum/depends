import { existsSync } from "node:fs";
import { join } from "node:path";
import { COLORS } from "../lib/colors";

export async function cmdAdmin(args: string[]) {
  const sub = args[1];

  // Admin commands operate directly on the local database
  const dbPath = join(process.cwd(), "data", "depends.db");
  if (!existsSync(dbPath)) {
    console.error(
      "Error: No database found at data/depends.db. Run from the server directory.",
    );
    process.exit(1);
  }

  const { createDb } = await import("../../db");
  const db = createDb(dbPath);

  if (sub === "tokens") {
    const tokens = db
      .query(
        "SELECT id, email, legendum_token, created_at FROM tokens ORDER BY created_at",
      )
      .all() as {
      id: string;
      email: string | null;
      legendum_token: string | null;
      created_at: string;
    }[];

    if (tokens.length === 0) {
      console.log("No tokens.");
      return;
    }

    const maxEmail = Math.max(5, ...tokens.map((t) => (t.email ?? "-").length));

    for (const t of tokens) {
      const email = (t.email ?? "-").padEnd(maxEmail);
      const linked = t.legendum_token ? "linked" : "unlinked";
      console.log(
        `  ${email}  ${linked}  ${COLORS.dim}${t.id}  ${t.created_at}${COLORS.reset}`,
      );
    }
  } else {
    console.error(`Usage:
  depends admin tokens              List all tokens`);
    process.exit(1);
  }
}
