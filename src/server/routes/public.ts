import { join } from "node:path";
import type { Elysia } from "elysia";
import { render } from "../../render";
import { DOCS_JSON } from "../docs-json";

const PUBLIC_DIR = join(import.meta.dir, "..", "..", "..", "public");

export function registerPublicRoutes<T extends Elysia>(app: T): T {
  return (
    app
      // Static files
      .get("/favicon.png", () => Bun.file(join(PUBLIC_DIR, "favicon.png")))
      .get("/logo.png", () => Bun.file(join(PUBLIC_DIR, "logo.png")))
      .get(
        "/example.svg",
        () =>
          new Response(Bun.file(join(PUBLIC_DIR, "example.svg")), {
            headers: { "Content-Type": "image/svg+xml" },
          }),
      )
      .get(
        "/llms.txt",
        () =>
          new Response(Bun.file(join(PUBLIC_DIR, "llms.txt")), {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      )
      .get(
        "/install.sh",
        () =>
          new Response(Bun.file(join(PUBLIC_DIR, "install.sh")), {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      )

      // Homepage & marketing
      .get("/", () =>
        render("index", {
          title: "depends.cc — dependency state tracking",
          nav: "home",
        }),
      )
      .get("/pricing", () =>
        render("pricing", { title: "Pricing — depends.cc", nav: "pricing" }),
      )
      .get("/signup", () =>
        render("signup", { title: "Sign up — depends.cc", nav: "signup" }),
      )
      .get("/license", () =>
        render("license", { title: "License — depends.cc" }),
      )
      .get("/privacy", () =>
        render("privacy", { title: "Privacy — depends.cc" }),
      )
      .get("/terms", () => render("terms", { title: "Terms — depends.cc" }))
      .get("/mcp", () =>
        render("mcp", { title: "MCP Server — depends.cc", nav: "mcp" }),
      )

      // Docs (JSON for machines, HTML for humans)
      .get("/docs", ({ request }) => {
        const accept = request.headers.get("Accept") ?? "";
        if (accept.includes("application/json")) {
          return Response.json(DOCS_JSON);
        }
        return render("docs", { title: "Docs — depends.cc", nav: "docs" });
      }) as T
  );
}
