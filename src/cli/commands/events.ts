import { api, errorMsg } from "../lib/api";
import { COLORS, colorState } from "../lib/colors";
import { type Config, getNamespace, parseCliArgs } from "../lib/config";

interface Event {
  node_id: string;
  previous_state: string | null;
  new_state: string;
  previous_effective_state: string | null;
  new_effective_state: string;
  reason: string | null;
  solution: string | null;
  created_at: string;
}

export async function cmdEvents(config: Config, args: string[]) {
  const { values, positionals } = parseCliArgs(args);
  const target = positionals.find((a) => a !== "events");
  const jsonOutput = !!values.json;
  const limit = typeof values.limit === "string" ? values.limit : "20";

  let ns: string;
  let nodeId: string | undefined;
  if (target?.includes("/")) {
    const slashIdx = target.indexOf("/");
    ns = target.slice(0, slashIdx);
    nodeId = target.slice(slashIdx + 1);
  } else {
    ns = getNamespace(config, args);
    nodeId = target;
  }

  const path = nodeId
    ? `/events/${ns}/${nodeId}?limit=${limit}&order=desc`
    : `/events/${ns}?limit=${limit}&order=desc`;

  const res = await api(config, path);
  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  const data = await res.json();
  const events: Event[] = Array.isArray(data) ? data : data.events;

  if (jsonOutput) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log("No events.");
    return;
  }

  for (const e of events) {
    const prev = e.previous_state
      ? colorState(e.previous_state)
      : `${COLORS.dim}(new)${COLORS.reset}`;
    const arrow = `${COLORS.dim}→${COLORS.reset}`;
    let context = "";
    if (e.reason || e.solution) {
      const parts = [];
      if (e.reason) parts.push(e.reason);
      if (e.solution) parts.push(`solution: ${e.solution}`);
      context = ` ${COLORS.dim}— ${parts.join("; ")}${COLORS.reset}`;
    }
    const time = `${COLORS.dim}${e.created_at}${COLORS.reset}`;
    console.log(
      `  ${time}  ${e.node_id}  ${prev} ${arrow} ${colorState(e.new_state)}${context}`,
    );
  }
}
