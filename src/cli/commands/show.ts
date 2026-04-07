import { api, errorMsg } from "../lib/api";
import { type Config, getNamespace } from "../lib/config";

export async function cmdShow(config: Config, args: string[]) {
  const ns = getNamespace(config, args);

  const res = await api(config, `/graph/${ns}?format=yaml`);
  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  const yamlContent = await res.text();
  process.stdout.write(yamlContent);
}
