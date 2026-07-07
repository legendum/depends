/**
 * `buildStyle({ root })` — build-time helper. Emits the consumer's
 * `<root>/public/dist/pues.css`. Sibling to `buildPwa` (`base/pwa/`).
 *
 * Output cascade:
 *
 *   layer 1 — :root + [data-theme="light"] blocks. Token values come
 *             from `base/style/tokens.ts` `DEFAULT_TOKENS`, with sparse
 *             overrides from pues.yaml `style.dark` / `style.light`
 *             layered on top. Mode-agnostic knobs from `style.vars`
 *             append a `:root` block (1b).
 *   reset   — the shared app-shell reset (`box-sizing`, `html/body`
 *             sizing, `body` font/bg/color, `#root` height). Default-on;
 *             a consumer opts out with `style.reset: false`. Element
 *             selectors — the documented exception to SPEC §8.
 *   screen  — the shared `.screen*` list/detail layout primitives
 *             (`.screen`, `--home`, `--detail`, `-header`, `-header-text`,
 *             `-title`). Default-on; opt out with `style.screen: false`.
 *             Class selectors; app-specific `.screen--*` variants stay in
 *             the consumer stylesheet.
 *   layer 2 — `base/style/defaults.css` verbatim: the rules for every
 *             pues-shipped component (ThemeChooser, ObjectList,
 *             AddButton, FilterBar, ObjectDetail, RenameTitle, Dialog).
 *             Every value is `var(--pues-*)`, resolved by layer 1.
 *   layer 3 — `style.css` if set: literal CSS appended last. Escape
 *             hatch for rules the variable surface does not cover.
 *
 * Output path (`<root>/public/dist/pues.css`) is a hardcoded
 * convention of the part, surfaced as a comment at the call site
 * rather than an opt — same lens as `buildPwa`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { defaultRoot } from "../core/defaultRoot";
import { readStyleConfig, type StyleConfig } from "./config";
import { cssVarName, DEFAULT_TOKENS, TOKEN_NAMES } from "./tokens";

export type BuildStyleArgs = {
  /** Host checkout root. Defaults to {@link defaultRoot} (vendored layout). */
  root?: string;
};

export type BuildStyleResult = {
  /** Absolute path of the emitted `pues.css`. */
  path: string;
  /** Byte length — useful for logs. */
  bytes: number;
};

export function buildStyle({
  root = defaultRoot(),
}: BuildStyleArgs = {}): BuildStyleResult {
  const cfg = readStyleConfig(root);
  const defaultsCss = readFileSync(
    join(import.meta.dirname, "defaults.css"),
    "utf8",
  );

  const css = render(cfg, defaultsCss);
  const outPath = join(root, "public/dist/pues.css");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, css);
  return { path: outPath, bytes: Buffer.byteLength(css) };
}

function render(cfg: StyleConfig, defaultsCss: string): string {
  const darkDecl = TOKEN_NAMES.map((t) => {
    const v = cfg.dark?.[t] ?? DEFAULT_TOKENS.dark[t];
    return `  ${cssVarName(t)}: ${v};`;
  });
  const lightDecl = TOKEN_NAMES.map((t) => {
    const v = cfg.light?.[t] ?? DEFAULT_TOKENS.light[t];
    return `  ${cssVarName(t)}: ${v};`;
  });

  const blocks: string[] = [];

  blocks.push(
    [
      "/* layer 1: pues theme tokens (base/style/tokens.ts + pues.yaml `style:` overrides) */",
      ":root {",
      "  color-scheme: dark;",
      ...darkDecl,
      "}",
      `[data-theme="light"] {`,
      "  color-scheme: light;",
      ...lightDecl,
      "}",
    ].join("\n"),
  );

  if (cfg.vars && Object.keys(cfg.vars).length > 0) {
    blocks.push(
      [
        "/* layer 1b: mode-agnostic --pues-* knobs from `style.vars` */",
        ":root {",
        ...Object.entries(cfg.vars).map(([k, v]) => `  --${k}: ${v};`),
        "}",
      ].join("\n"),
    );
  }

  if (cfg.reset !== false) {
    blocks.push(
      [
        "/* reset: shared app-shell base reset (default-on; set `style.reset:",
        "   false` to opt out). Element selectors — the documented exception",
        "   to SPEC §8. `--pues-topbar-height` defaults to 65px; override via",
        "   `style.vars`. */",
        "* {",
        "  box-sizing: border-box;",
        "}",
        "html,",
        "body {",
        "  height: 100%;",
        "}",
        "body {",
        "  margin: 0;",
        "  padding-top: var(--pues-topbar-height, 65px);",
        "  font-family: system-ui, -apple-system, sans-serif;",
        "  background: var(--pues-bg-page);",
        "  color: var(--pues-text-primary);",
        "}",
        "#root {",
        "  height: 100%;",
        "}",
      ].join("\n"),
    );
  }

  if (cfg.screen !== false) {
    blocks.push(
      [
        "/* screen: shared list/detail screen-layout primitives (default-on;",
        "   set `style.screen: false` to opt out). A consumer's own screen",
        "   variants (custom `.screen--*` modifiers, loading/empty states)",
        "   stay in its own stylesheet. */",
        ".screen {",
        "  padding-bottom: 24px;",
        "}",
        ".screen--home {",
        "  padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px));",
        "}",
        ".screen--detail {",
        "  display: flex;",
        "  flex-direction: column;",
        "  height: 100%;",
        "  padding-bottom: 0;",
        "  min-height: 0;",
        "}",
        ".screen-header {",
        "  display: flex;",
        "  align-items: center;",
        "  gap: 12px;",
        "  padding: 12px 16px;",
        "  border-bottom: 1px solid var(--pues-border-default);",
        "}",
        ".screen-header-text {",
        "  flex: 1;",
        "  min-width: 0;",
        "  display: flex;",
        "  flex-direction: column;",
        "  gap: 2px;",
        "}",
        ".screen-title {",
        "  font-size: 18px;",
        "  font-weight: 600;",
        "  margin: 0;",
        "}",
      ].join("\n"),
    );
  }

  blocks.push(
    [
      "/* layer 2: pues default rules (base/style/defaults.css) */",
      defaultsCss.trimEnd(),
    ].join("\n"),
  );

  if (cfg.css) {
    blocks.push(
      [
        "/* layer 3: literal CSS from pues.yaml `style.css` */",
        cfg.css.trimEnd(),
      ].join("\n"),
    );
  }

  return `${blocks.join("\n\n")}\n`;
}
