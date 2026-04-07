import { api, errorMsg } from "../lib/api";
import { colorState } from "../lib/colors";
import { type Config, getNamespace, parseCliArgs } from "../lib/config";

export async function cmdSet(config: Config, args: string[]) {
  const { values, positionals } = parseCliArgs(args);
  const positional = positionals.filter((a) => a !== "set");

  if (positional.length < 2) {
    console.error(
      "Usage: depends set [<namespace>/]<node-id> <state> [--reason <reason>] [--solution <solution>]",
    );
    process.exit(1);
  }

  const [target, state] = positional;

  // Support namespace/node syntax
  let ns: string;
  let nodeId: string;
  if (target.includes("/")) {
    const slashIdx = target.indexOf("/");
    ns = target.slice(0, slashIdx);
    nodeId = target.slice(slashIdx + 1);
  } else {
    ns = getNamespace(config, args);
    nodeId = target;
  }
  if (!["green", "yellow", "red"].includes(state)) {
    console.error(
      `Error: Invalid state "${state}". Must be green, yellow, or red.`,
    );
    process.exit(1);
  }

  const headers: Record<string, string> = {};
  if (typeof values.reason === "string") headers["X-Reason"] = values.reason;
  if (typeof values.solution === "string")
    headers["X-Solution"] = values.solution;

  const res = await api(config, `/state/${ns}/${nodeId}/${state}`, {
    method: "PUT",
    headers,
  });

  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  console.log(`${nodeId} → ${colorState(state)}`);
}
