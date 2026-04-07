import { api } from "../lib/api";
import type { Config } from "../lib/config";

export async function cmdSignup(config: Config, args: string[]) {
  let email = args.find((a) => a.includes("@"));
  let accountKey = args.find((a) => a.startsWith("lak_"));

  if (!email) {
    process.stdout.write("Email: ");
    email = await new Promise<string>((resolve) => {
      let input = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (chunk) => {
        input += chunk;
        if (input.includes("\n")) {
          process.stdin.pause();
          resolve(input.trim());
        }
      });
      process.stdin.resume();
    });
  }

  if (!accountKey) {
    process.stdout.write("Legendum account key (lak_...): ");
    accountKey = await new Promise<string>((resolve) => {
      let input = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (chunk) => {
        input += chunk;
        if (input.includes("\n")) {
          process.stdin.pause();
          resolve(input.trim());
        }
      });
      process.stdin.resume();
    });
  }

  const res = await api(config, "/signup", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email, account_key: accountKey }),
    contentType: "application/json",
  });
  const text = await res.text();
  let data: Record<string, string>;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`Error: Unexpected response from server (${res.status}):`);
    console.error(text.slice(0, 200));
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Error: ${data.error}`);
    process.exit(1);
  }
  console.log(data.message);
  console.log(`\nOnce you receive your token, save it:`);
  console.log(`  export DEPENDS_TOKEN=<your-token>`);
  console.log(`Or add it to ~/.config/depends/config.yml`);
}
