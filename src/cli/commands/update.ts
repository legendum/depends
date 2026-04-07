import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export async function cmdUpdate() {
  const srcDir = join(homedir(), ".config", "depends", "src");
  if (!existsSync(srcDir)) {
    console.error("Error: depends not installed via install.sh. Run:");
    console.error("  curl -fsSL https://depends.cc/install.sh | sh");
    process.exit(1);
  }

  console.log("Updating depends...");
  try {
    execSync("git pull --quiet", { cwd: srcDir, stdio: "inherit" });
    execSync("bun install --silent", { cwd: srcDir, stdio: "inherit" });
    console.log("Updated to latest version.");
  } catch {
    console.error("Error: update failed.");
    process.exit(1);
  }
}
