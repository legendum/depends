export async function formatNodesAsText(jsonRes: Response): Promise<Response> {
  const nodes = (await jsonRes.json()) as Array<{
    id: string;
    state: string;
    effective_state: string;
    label: string | null;
    reason: string | null;
  }>;
  if (nodes.length === 0)
    return new Response("No nodes in this namespace.\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const maxId = Math.max(...nodes.map((n) => n.id.length));
  const lines = nodes.map((n) => {
    const id = n.id.padEnd(maxId);
    const eff =
      n.state !== n.effective_state ? ` (effective: ${n.effective_state})` : "";
    const label = n.label ? ` ${n.label}` : "";
    const reason = n.reason ? ` — ${n.reason}` : "";
    return `  ${id}  ${n.state}${eff}${label}${reason}`;
  });
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function formatNodeAsText(jsonRes: Response): Promise<Response> {
  if (jsonRes.status === 404)
    return new Response("Node not found.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  const n = (await jsonRes.json()) as {
    id: string;
    state: string;
    effective_state: string;
    label: string | null;
    reason: string | null;
    solution: string | null;
    depends_on: string[];
    depended_on_by: string[];
  };
  const lines: string[] = [];
  lines.push(
    `${n.id}  ${n.state}${n.state !== n.effective_state ? ` (effective: ${n.effective_state})` : ""}`,
  );
  if (n.label) lines.push(`  label: ${n.label}`);
  if (n.reason) lines.push(`  reason: ${n.reason}`);
  if (n.solution) lines.push(`  solution: ${n.solution}`);
  if (n.depends_on.length > 0)
    lines.push(`  depends_on: ${n.depends_on.join(", ")}`);
  if (n.depended_on_by.length > 0)
    lines.push(`  depended_on_by: ${n.depended_on_by.join(", ")}`);
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
