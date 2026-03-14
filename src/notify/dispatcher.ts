import { Database } from "bun:sqlite";
import {
  computeEffectiveState,
  getDownstreamNodes,
} from "../graph/effective";
import { sendWebhook, type WebhookPayload } from "./webhook";

interface NotificationRule {
  namespace: string;
  id: string;
  watch: string;
  on_state: string;
  url: string | null;
  email: string | null;
  secret: string | null;
  ack: number;
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

/**
 * Called after a node's state changes. Evaluates notification rules and fires webhooks.
 * Also records events for any effective state changes on downstream nodes.
 */
export function dispatchNotifications(
  db: Database,
  namespace: string,
  nodeId: string,
  previousState: string | null,
  newState: string,
  previousEffectiveState: string | null,
  reason?: string | null
): void {
  const newEffectiveState = computeEffectiveState(db, namespace, nodeId);

  // Record event for the changed node
  db.query(
    `INSERT INTO events (namespace, node_id, previous_state, new_state, previous_effective_state, new_effective_state, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    namespace,
    nodeId,
    previousState,
    newState,
    previousEffectiveState,
    newEffectiveState,
    reason ?? null
  );

  // Collect all nodes whose effective state may have changed
  const affectedNodes: {
    id: string;
    newEffective: string;
    prevEffective: string | null;
  }[] = [];

  // The node itself
  if (newEffectiveState !== previousEffectiveState) {
    affectedNodes.push({
      id: nodeId,
      newEffective: newEffectiveState,
      prevEffective: previousEffectiveState,
    });
  }

  // Downstream nodes — their effective state might have changed too
  const downstream = getDownstreamNodes(db, namespace, nodeId);
  for (const downId of downstream) {
    const newEff = computeEffectiveState(db, namespace, downId);

    // We need the previous effective state of downstream nodes.
    // Look at the most recent event for this node, or compute from the graph
    // before the change. Since we already changed the state, we approximate
    // by checking if the new effective state differs from what it would be.
    // For simplicity, we record an event if the effective state is not green
    // or if we can detect a change.
    const lastEvent = db
      .query(
        `SELECT new_effective_state FROM events
         WHERE namespace = ? AND node_id = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(namespace, downId) as { new_effective_state: string } | null;

    // If no prior event exists, this node has never been tracked.
    // We still record an event (prevEff=null means "first observation").
    const prevEff = lastEvent?.new_effective_state ?? null;

    if (prevEff !== newEff) {
      // Record event for downstream node (state didn't change, effective did)
      const downNode = db
        .query("SELECT state FROM nodes WHERE namespace = ? AND id = ?")
        .get(namespace, downId) as { state: string };

      db.query(
        `INSERT INTO events (namespace, node_id, previous_state, new_state, previous_effective_state, new_effective_state)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(namespace, downId, downNode.state, downNode.state, prevEff, newEff);

      affectedNodes.push({
        id: downId,
        newEffective: newEff,
        prevEffective: prevEff,
      });
    }
  }

  // Now fire notifications for all affected nodes
  if (affectedNodes.length === 0) return;

  const rules = db
    .query(
      "SELECT * FROM notification_rules WHERE namespace = ? AND suppressed = 0"
    )
    .all(namespace) as NotificationRule[];

  for (const affected of affectedNodes) {
    for (const rule of rules) {
      if (
        !ruleMatchesNode(rule, affected.id) ||
        !ruleMatchesState(rule, affected.newEffective)
      ) {
        continue;
      }

      // Get the node's current reason
      const nodeData = db
        .query("SELECT reason FROM nodes WHERE namespace = ? AND id = ?")
        .get(namespace, affected.id) as { reason: string | null } | null;

      const payload: WebhookPayload = {
        event: "effective_state_changed",
        namespace,
        node_id: affected.id,
        state: affected.newEffective,
        effective_state: affected.newEffective,
        previous_effective_state: affected.prevEffective ?? "unknown",
        reason: nodeData?.reason ?? null,
        triggered_rule: rule.id,
        timestamp: new Date().toISOString(),
      };

      if (rule.url) {
        // Fire and forget — don't block the response
        sendWebhook(rule.url, payload, rule.secret);
      }
      // Email: TODO — internal webhook to email service

      if (rule.ack) {
        db.query(
          "UPDATE notification_rules SET suppressed = 1, last_fired_at = datetime('now') WHERE namespace = ? AND id = ?"
        ).run(namespace, rule.id);
      } else {
        db.query(
          "UPDATE notification_rules SET last_fired_at = datetime('now') WHERE namespace = ? AND id = ?"
        ).run(namespace, rule.id);
      }
    }
  }
}
