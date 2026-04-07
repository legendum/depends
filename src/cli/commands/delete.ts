import { api, errorMsg } from "../lib/api";
import { type Config, getNamespace } from "../lib/config";

export async function cmdDelete(config: Config, args: string[]) {
  const ns = getNamespace(config, args);

  const res = await api(config, `/namespaces/${ns}`, { method: "DELETE" });

  if (!res.ok) {
    console.error(`Error: ${await errorMsg(res)}`);
    process.exit(1);
  }

  console.log(`Deleted namespace "${ns}" and all its data.`);
}
