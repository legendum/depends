import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { COLORS } from "./colors";

export interface Config {
  default_namespace?: string;
  token?: string;
  api_url?: string;
}

export const CLI_OPTIONS = {
  namespace: { type: "string", short: "n" },
  reason: { type: "string" },
  solution: { type: "string" },
  limit: { type: "string" },
  json: { type: "boolean" },
  prune: { type: "boolean" },
  "dry-run": { type: "boolean" },
  port: { type: "string", short: "p" },
  help: { type: "boolean", short: "h" },
} as const;

export function parseCliArgs(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: CLI_OPTIONS,
    allowPositionals: true,
    strict: false,
  });
  return { values, positionals };
}

export function loadConfig(): Config {
  const envToken = process.env.DEPENDS_TOKEN;
  const envNs = process.env.DEPENDS_NAMESPACE;
  const envUrl = process.env.DEPENDS_API_URL;

  const configPath =
    process.env.DEPENDS_CONFIG ??
    join(homedir(), ".config", "depends", "config.yml");
  let fileConfig: Config = {};
  if (existsSync(configPath)) {
    try {
      fileConfig =
        (yaml.load(readFileSync(configPath, "utf-8")) as Config) ?? {};
    } catch {}
  }

  const token = envToken ?? fileConfig.token;
  const apiUrl = envUrl ?? fileConfig.api_url;

  // No token configured anywhere → local mode
  if (!token) {
    const localUrl = apiUrl ?? "http://localhost:3000/v1";
    console.error(
      `${COLORS.dim}Using local mode (dep_local → ${localUrl}). Set DEPENDS_TOKEN for production.${COLORS.reset}`,
    );
    return {
      token: "dep_local",
      default_namespace: envNs ?? fileConfig.default_namespace,
      api_url: localUrl,
    };
  }

  return {
    token,
    default_namespace: envNs ?? fileConfig.default_namespace,
    api_url: apiUrl ?? "https://depends.cc/v1",
  };
}

export function getToken(config: Config): string {
  if (!config.token) {
    console.error("Error: No token configured.");
    console.error(
      "Set DEPENDS_TOKEN or add token to ~/.config/depends/config.yml",
    );
    process.exit(1);
  }
  return config.token;
}

export function getNamespace(config: Config, args: string[]): string {
  const { values } = parseCliArgs(args);
  if (typeof values.namespace === "string") return values.namespace;

  // Try depends.yml in current directory — read raw (no env substitution)
  // since we only care about the namespace field and don't want to error
  // out on unrelated ${VAR} references.
  if (existsSync("depends.yml")) {
    try {
      const spec = yaml.load(readFileSync("depends.yml", "utf-8")) as {
        namespace?: string;
      };
      if (spec?.namespace) return spec.namespace;
    } catch {}
  }

  if (config.default_namespace) return config.default_namespace;

  console.error("Error: No namespace specified.");
  console.error(
    "Use -n <namespace>, set DEPENDS_NAMESPACE, add default_namespace to ~/.config/depends/config.yml, or have a depends.yml in the current directory.",
  );
  process.exit(1);
}
