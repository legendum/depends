import { existsSync, readFileSync } from "node:fs";
import yaml from "js-yaml";
import { api, errorMsg } from "../lib/api";
import { type Config, getNamespace, parseCliArgs } from "../lib/config";

export async function cmdPush(config: Config, args: string[]) {
  const ns = getNamespace(config, args);
  const filePath = existsSync("depends.yml") ? "depends.yml" : null;

  if (!filePath) {
    console.error("Error: No depends.yml found in current directory.");
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf-8");
  const spec = yaml.load(content) as { namespace?: string };

  if (spec?.namespace && spec.namespace !== ns) {
    console.error(
      `Error: depends.yml namespace "${spec.namespace}" doesn't match target namespace "${ns}".`,
    );
    process.exit(1);
  }

  // Override namespace in YAML to match target
  const yamlToSend = content.replace(/^namespace:.*$/m, `namespace: ${ns}`);

  // Auto-create namespace if it doesn't exist (ignore 409 conflict)
  const createRes = await api(config, "/namespaces", {
    method: "POST",
    body: JSON.stringify({ id: ns }),
    contentType: "application/json",
  });
  if (!createRes.ok && createRes.status !== 409) {
    console.error(`Error creating namespace: ${await errorMsg(createRes)}`);
    process.exit(1);
  }
  if (createRes.status === 201) {
    console.log(`Created namespace "${ns}".`);
  }

  const prune = !!parseCliArgs(args).values.prune;
  const url = `/graph/${ns}${prune ? "?prune=true" : ""}`;

  const res = await api(config, url, {
    method: "PUT",
    body: yamlToSend,
    contentType: "application/yaml",
  });

  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  console.log(
    `Pushed depends.yml to namespace "${ns}".${prune ? " (pruned)" : ""}`,
  );
}
