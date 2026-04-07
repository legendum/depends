import { existsSync, writeFileSync } from "node:fs";

export async function cmdInit() {
  if (existsSync("depends.yml")) {
    console.error("depends.yml already exists in this directory.");
    process.exit(1);
  }

  // Derive namespace from current directory name, sanitized to valid ID
  const dirName = process.cwd().split("/").pop() ?? "my-project";
  const namespace =
    dirName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "") || "my-project";

  const scaffold = `namespace: ${namespace}

nodes:
  database:
    label: Database

  api-server:
    label: API Server
    depends_on:
      - database
`;

  writeFileSync("depends.yml", scaffold);
  console.log("Created depends.yml — edit it to define your dependency graph.");
}
