import { api, errorMsg } from "../lib/api";
import { COLORS } from "../lib/colors";
import { type Config, getNamespace, parseCliArgs } from "../lib/config";

export async function cmdUsage(config: Config, args: string[]) {
  const ns = getNamespace(config, args);
  const jsonOutput = !!parseCliArgs(args).values.json;

  const res = await api(config, `/usage/${ns}`);
  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  const data = await res.json();

  if (jsonOutput) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(`${COLORS.bold}${ns}${COLORS.reset} — ${data.period}`);
  console.log();
  console.log(
    `  Nodes          ${data.nodes} total, ${data.active_nodes} active this month`,
  );
  console.log(`  Events         ${data.total_events} this month`);
  if (data.webhook_deliveries > 0)
    console.log(`  Webhooks       ${data.webhook_deliveries} fired this month`);
  if (data.emails_sent > 0)
    console.log(`  Emails         ${data.emails_sent} sent this month`);
}
