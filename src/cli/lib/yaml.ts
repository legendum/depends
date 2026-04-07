import { readFileSync } from "node:fs";

/**
 * Read depends.yml and substitute ${VAR} / ${VAR:-default} references with
 * values from process.env. Unknown vars without a default cause a hard error.
 */
export function readDependsYml(path = "depends.yml"): string {
  const raw = readFileSync(path, "utf-8");
  return raw.replace(
    /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g,
    (_match, name: string, fallback: string | undefined) => {
      const value = process.env[name];
      if (value !== undefined && value !== "") return value;
      if (fallback !== undefined) return fallback;
      console.error(
        `Error: environment variable ${name} is not set (referenced in ${path}).`,
      );
      console.error(`Use \${${name}:-default} to provide a fallback.`);
      process.exit(1);
    },
  );
}
