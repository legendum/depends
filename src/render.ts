import { Eta } from "eta";
import { join } from "path";

const VIEWS_DIR = join(import.meta.dir, "..", "views");

const eta = new Eta({ views: VIEWS_DIR, cache: true });

/**
 * Render a page template inside the layout.
 * The page template is rendered first, then injected as `body` into layout.eta.
 */
export function render(
  page: string,
  data: Record<string, unknown> = {}
): Response {
  const body = eta.render(page, data);
  const html = eta.render("layout", { ...data, body });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
