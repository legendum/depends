import { existsSync } from "node:fs";
import yaml from "js-yaml";
import { api, errorMsg } from "../lib/api";
import { COLORS, colorState } from "../lib/colors";
import { type Config, getNamespace, parseCliArgs } from "../lib/config";
import { readDependsYml } from "../lib/yaml";

interface Check {
  url: string;
  grep: string | string[];
}

interface CheckResult {
  nodeId: string;
  ok: boolean;
  failures: string[];
}

export async function runChecks(
  nodeId: string,
  checks: Check[],
): Promise<CheckResult> {
  const failures: string[] = [];
  for (const check of checks) {
    try {
      const res = await fetch(check.url, {
        headers: { "User-Agent": "depends-check/1.0" },
        redirect: "follow",
      });
      if (!res.ok) {
        failures.push(`${check.url} returned ${res.status}`);
        continue;
      }
      const body = await res.text();
      const greps = Array.isArray(check.grep) ? check.grep : [check.grep];
      for (const g of greps) {
        if (!body.includes(g)) {
          failures.push(`${check.url} missing "${g}"`);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${check.url} fetch failed: ${msg}`);
    }
  }
  return { nodeId, ok: failures.length === 0, failures };
}

export async function cmdCheck(config: Config, args: string[]) {
  if (!existsSync("depends.yml")) {
    console.error("Error: No depends.yml in current directory.");
    process.exit(1);
  }

  const spec = yaml.load(readDependsYml()) as {
    namespace?: string;
    nodes?: Record<string, { meta?: { checks?: Check[] } }>;
  };

  if (!spec?.namespace) {
    console.error("Error: depends.yml must have a namespace field.");
    process.exit(1);
  }

  const ns = getNamespace(config, args);
  const nodes = spec.nodes ?? {};
  const checkable = Object.entries(nodes).filter(
    ([, node]) =>
      Array.isArray(node.meta?.checks) && node.meta!.checks!.length > 0,
  );

  if (checkable.length === 0) {
    console.log("No nodes with meta.checks defined.");
    return;
  }

  const dryRun = !!parseCliArgs(args).values["dry-run"];

  // Run all node checks in parallel
  const results = await Promise.all(
    checkable.map(([id, node]) => runChecks(id, node.meta!.checks!)),
  );

  // Report and PUT state for each node
  let allOk = true;
  for (const result of results) {
    const state = result.ok ? "green" : "red";
    if (!result.ok) allOk = false;

    const reason = result.ok ? undefined : result.failures.join("; ");

    console.log(
      `  ${result.nodeId.padEnd(20)} ${colorState(state)}${reason ? ` — ${reason}` : ""}`,
    );

    if (!dryRun) {
      const headers: Record<string, string> = {};
      if (reason) headers["X-Reason"] = reason;
      if (reason) headers["X-Solution"] = "check service health";

      const res = await api(config, `/state/${ns}/${result.nodeId}/${state}`, {
        method: "PUT",
        headers,
      });

      if (!res.ok) {
        console.error(
          `  ${COLORS.red}failed to update ${result.nodeId}: ${await errorMsg(res)}${COLORS.reset}`,
        );
      }
    }
  }

  if (dryRun) {
    console.log(
      `\n${COLORS.dim}(dry run — no state changes pushed)${COLORS.reset}`,
    );
  }

  process.exit(allOk ? 0 : 1);
}
