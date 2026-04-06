import type { Database } from "bun:sqlite";
import { computeEffectiveState, getDownstreamNodes } from "../graph/effective";
import { sendEmail } from "./email";
import { sendWebhook, type WebhookPayload } from "./webhook";

const legendum = require("../lib/legendum.js");

interface NotificationRule {
  ns_id: number;
  id: string;
  watch: string;
  on_state: string;
  url: string | null;
  email: string | null;
  secret: string | null;
  ack: number;
  ack_token: string | null;
  suppressed: number;
}

function ruleMatchesState(rule: NotificationRule, state: string): boolean {
  if (rule.on_state === "*") return true;
  const states = rule.on_state.split(",");
  return states.includes(state);
}

function ruleMatchesNode(rule: NotificationRule, nodeId: string): boolean {
  return rule.watch === "*" || rule.watch === nodeId;
}

async function chargeNotification(
  legendumToken: string | null,
  amount: number,
  description: string,
): Promise<void> {
  if (!legendumToken) return;
  try {
    await legendum.charge(legendumToken, amount, description);
  } catch {
    // best-effort — don't block notifications on charge failure
  }
}

export function dispatchNotifications(
  db: Database,
  nsId: number,
  namespace: string,
  nodeId: string,
  previousState: string | null,
  newState: string,
  previousEffectiveState: string | null,
  reason?: string | null,
  solution?: string | null,
  legendumToken?: string | null,
): void {
  const newEffectiveState = computeEffectiveState(db, nsId, nodeId);

  db.query(
    `INSERT INTO events (ns_id, node_id, previous_state, new_state, previous_effective_state, new_effective_state, reason, solution)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nsId,
    nodeId,
    previousState,
    newState,
    previousEffectiveState,
    newEffectiveState,
    reason ?? null,
    solution ?? null,
  );

  const affectedNodes: {
    id: string;
    newEffective: string;
    prevEffective: string | null;
  }[] = [];

  if (newEffectiveState !== previousEffectiveState) {
    affectedNodes.push({
      id: nodeId,
      newEffective: newEffectiveState,
      prevEffective: previousEffectiveState,
    });
  }

  const downstream = getDownstreamNodes(db, nsId, nodeId);
  for (const downId of downstream) {
    const newEff = computeEffectiveState(db, nsId, downId);

    const lastEvent = db
      .query(
        `SELECT new_effective_state FROM events
         WHERE ns_id = ? AND node_id = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(nsId, downId) as { new_effective_state: string } | null;

    const prevEff = lastEvent?.new_effective_state ?? null;

    if (prevEff !== newEff) {
      const downNode = db
        .query("SELECT state FROM nodes WHERE ns_id = ? AND id = ?")
        .get(nsId, downId) as { state: string };

      db.query(
        `INSERT INTO events (ns_id, node_id, previous_state, new_state, previous_effective_state, new_effective_state, reason, solution)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
      ).run(nsId, downId, downNode.state, downNode.state, prevEff, newEff);

      affectedNodes.push({
        id: downId,
        newEffective: newEff,
        prevEffective: prevEff,
      });
    }
  }

  if (affectedNodes.length === 0) return;

  const rules = db
    .query(
      "SELECT * FROM notification_rules WHERE ns_id = ? AND suppressed = 0",
    )
    .all(nsId) as NotificationRule[];

  const lt = legendumToken ?? null;

  for (const affected of affectedNodes) {
    for (const rule of rules) {
      if (
        !ruleMatchesNode(rule, affected.id) ||
        !ruleMatchesState(rule, affected.newEffective)
      ) {
        continue;
      }

      const nodeData = db
        .query("SELECT reason, solution FROM nodes WHERE ns_id = ? AND id = ?")
        .get(nsId, affected.id) as {
        reason: string | null;
        solution: string | null;
      } | null;

      const baseUrl = process.env.BASE_URL ?? "https://depends.cc";
      const title = `${namespace}/${affected.id} is ${affected.newEffective}`;
      const body =
        nodeData?.reason ?? `was ${affected.prevEffective ?? "unknown"}`;

      const payload: WebhookPayload = {
        event: "effective_state_changed",
        namespace,
        node_id: affected.id,
        state: affected.newEffective,
        effective_state: affected.newEffective,
        previous_effective_state: affected.prevEffective ?? "unknown",
        reason: nodeData?.reason ?? null,
        solution: nodeData?.solution ?? null,
        triggered_rule: rule.id,
        timestamp: new Date().toISOString(),
        title,
        body,
        ...(rule.ack_token
          ? { ack_url: `${baseUrl}/v1/ack/${rule.ack_token}` }
          : {}),
      };

      if (rule.url) {
        sendWebhook(rule.url, payload, rule.secret);
        chargeNotification(lt, 2, `webhook: ${namespace}/${affected.id}`);
      }
      if (rule.email) {
        sendEmail(rule.email, payload);
        chargeNotification(lt, 2, `email: ${namespace}/${affected.id}`);
      }

      if (rule.ack) {
        db.query(
          "UPDATE notification_rules SET suppressed = 1, last_fired_at = datetime('now') WHERE ns_id = ? AND id = ?",
        ).run(nsId, rule.id);
      } else {
        db.query(
          "UPDATE notification_rules SET last_fired_at = datetime('now') WHERE ns_id = ? AND id = ?",
        ).run(nsId, rule.id);
      }
    }
  }
}
