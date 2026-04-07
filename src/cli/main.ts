#!/usr/bin/env bun

import { cmdAdmin } from "./commands/admin";
import { cmdCheck } from "./commands/check";
import { cmdDelete } from "./commands/delete";
import { cmdDiff } from "./commands/diff";
import { cmdEvents } from "./commands/events";
import { cmdGraph } from "./commands/graph";
import { cmdInit } from "./commands/init";
import { cmdPull } from "./commands/pull";
import { cmdPush } from "./commands/push";
import { cmdServe } from "./commands/serve";
import { cmdSet } from "./commands/set";
import { cmdShow } from "./commands/show";
import { cmdSignup } from "./commands/signup";
import { cmdStatus } from "./commands/status";
import { cmdUpdate } from "./commands/update";
import { cmdUsage } from "./commands/usage";
import { cmdValidate } from "./commands/validate";
import { COLORS } from "./lib/colors";
import { loadConfig, parseCliArgs } from "./lib/config";

function printUsage() {
  console.log(`${COLORS.bold}depends${COLORS.reset} — CLI for depends.cc

${COLORS.bold}Usage:${COLORS.reset}
  depends serve [-p <port>]                   Run the server locally (default: 3000)
  depends signup <email> <lak_...>             Sign up (token emailed to you)
  depends init                                Create a depends.yml in the current directory
  depends push [--prune]                      Upload depends.yml (auto-creates namespace)
  depends pull                                Download graph as depends.yml
  depends show                                Print the current spec (YAML) without saving
  depends status [<node-id>]                  Show node states (color-coded)
  depends set [<namespace>/]<node-id> <state> Set a node's state (green/yellow/red)
  depends graph                               Print dependency tree
  depends events [<ns/node>]                   Show recent state changes
  depends validate                            Check depends.yml for errors
  depends delete                              Delete a namespace and all its data
  depends usage                               Show usage stats for current billing period
  depends check [--dry-run]                   Run meta.checks and update state
  depends diff                                Show what would change on push
  depends update                              Update to the latest version
  depends admin tokens                        List all tokens (server admin)
  depends admin plan <email> [plan]            Show or set plan for an email

${COLORS.bold}Options:${COLORS.reset}
  -n, --namespace <ns>    Override namespace
  -p <port>               Port for serve (default: 3000)
  --json                  Output as JSON (with status, events)
  --limit <n>             Number of events to show (default: 20)
  --reason <text>         Reason for state change (with set)
  --solution <text>       Recommended fix (with set)

${COLORS.bold}Config:${COLORS.reset}
  ~/.config/depends/config.yml   token, default_namespace, api_url
  DEPENDS_TOKEN           Environment variable for auth token
  DEPENDS_NAMESPACE       Environment variable for namespace`);
}

async function main() {
  const args = process.argv.slice(2);
  const { values, positionals } = parseCliArgs(args);
  const command = positionals[0];

  if (!command || values.help) {
    printUsage();
    process.exit(0);
  }

  // Commands that don't need a config/token
  switch (command) {
    case "serve":
      await cmdServe(args);
      return;
    case "update":
      await cmdUpdate();
      return;
    case "signup":
      // Always use production API for signup — never local mode
      await cmdSignup(
        { api_url: process.env.DEPENDS_API_URL ?? "https://depends.cc/v1" },
        args,
      );
      return;
  }

  const config = loadConfig();

  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "push":
      await cmdPush(config, args);
      break;
    case "pull":
      await cmdPull(config, args);
      break;
    case "show":
      await cmdShow(config, args);
      break;
    case "status":
      await cmdStatus(config, args);
      break;
    case "set":
      await cmdSet(config, args);
      break;
    case "graph":
      await cmdGraph(config, args);
      break;
    case "events":
      await cmdEvents(config, args);
      break;
    case "validate":
      await cmdValidate();
      break;
    case "delete":
      await cmdDelete(config, args);
      break;
    case "usage":
      await cmdUsage(config, args);
      break;
    case "check":
      await cmdCheck(config, args);
      break;
    case "diff":
      await cmdDiff(config, args);
      break;
    case "admin":
      await cmdAdmin(args);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main();
