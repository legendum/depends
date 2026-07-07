/**
 * Read + validate the `style:` section of `<root>/config/pues.yaml`.
 *
 * Every field is optional. A consumer that vendors `style` without
 * declaring `style:` gets pues defaults verbatim — pues.css contains
 * the baked `tokens.ts` palette + `defaults.css` component styles, no
 * overrides. The `style:` block lets a consumer override:
 *
 *   1. Theme tokens (sparse subset of `tokens.ts`'s vocabulary) under
 *      `style.dark` / `style.light`. Both blocks optional, both accept
 *      any subset of TOKEN_NAMES.
 *   2. Additional `--pues-*` knobs (e.g. `pues-dialog-border-radius`)
 *      under `style.vars`. Keys are written verbatim.
 *   3. Literal CSS appended after pues defaults under `style.css` —
 *      the final escape hatch.
 *
 * Used by `buildStyle` (build-time) and `base/pwa/config.ts` (reads
 * `style.dark.bg_page` / `style.dark.chrome` as PWA manifest fallback).
 * The style part reads pues.yaml directly so a consumer vendoring
 * `style` is not forced to also vendor `objects`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TOKEN_NAMES, type TokenName } from "./tokens";

export type StyleOverrides = Partial<Record<TokenName, string>>;

export type StyleConfig = {
  /** Sparse overrides for the dark palette. Drives `:root { … }`. */
  dark?: StyleOverrides;
  /** Sparse overrides for the light palette. Drives
   * `[data-theme="light"] { … }`. */
  light?: StyleOverrides;
  /** Additional `--pues-*` knobs. Keys verbatim — include the
   * `pues-` prefix yourself. Applied to `:root`. */
  vars?: Record<string, string>;
  /** Literal CSS appended after pues defaults. Use sparingly. */
  css?: string;
  /** Emit the shared app-shell base reset (`box-sizing`, `html/body`
   * sizing, `body` font/bg/color, `#root` height) that every consumer
   * otherwise hand-rolls identically. **Default-on** — set `false` to
   * opt out (a consumer that wants no pues reset at all). The only
   * tunable is `--pues-topbar-height` (default `65px`, overridable via
   * `style.vars`); colors come from the token palette. Element selectors
   * here are a deliberate exception to SPEC §8's "no element selectors"
   * rule — this is the app shell, not component chrome. Consumers keep
   * any app-specific extras (scrollbar-gutter, font-smoothing, `#root`
   * max-width) in their own stylesheet. */
  reset?: boolean;
  /** Emit the shared screen-layout primitives — `.screen`,
   * `.screen--home` (FAB/theme-dock bottom clearance), `.screen--detail`,
   * `.screen-header`, `.screen-header-text`, `.screen-title` — that
   * list/detail consumers otherwise hand-roll identically. **Default-on**
   * — set `false` to opt out (a consumer with a bespoke screen layout,
   * e.g. one that pads every screen flat rather than only `--home`).
   * Class selectors, so no SPEC §8 exception. A consumer's own screen
   * variants (custom `.screen--*` modifiers, loading/empty states) stay
   * in its stylesheet. */
  screen?: boolean;
};

export function readStyleConfig(root: string): StyleConfig {
  const yamlPath = join(root, "config/pues.yaml");
  if (!existsSync(yamlPath)) {
    // Pues.yaml is the consumer's contract; treat "no file" as empty.
    return {};
  }
  let text: string;
  try {
    text = readFileSync(yamlPath, "utf8");
  } catch (cause) {
    throw new Error(`[pues/style] could not read ${yamlPath}`, { cause });
  }

  const parsed = Bun.YAML.parse(text) as { style?: unknown } | null;
  const style = parsed?.style;
  if (style === undefined || style === null) return {};
  if (typeof style !== "object") {
    throw new Error(
      `[pues/style] ${yamlPath} 'style' must be a map (got ${typeof style}).`,
    );
  }

  const raw = style as Record<string, unknown>;

  const dark = parseOverrides(yamlPath, "dark", raw.dark);
  const light = parseOverrides(yamlPath, "light", raw.light);
  const vars = parseVars(yamlPath, raw.vars);

  if (raw.css !== undefined && typeof raw.css !== "string") {
    throw new Error(
      `[pues/style] ${yamlPath} 'style.css' must be a string (literal CSS).`,
    );
  }

  if (raw.reset !== undefined && typeof raw.reset !== "boolean") {
    throw new Error(
      `[pues/style] ${yamlPath} 'style.reset' must be a boolean.`,
    );
  }

  if (raw.screen !== undefined && typeof raw.screen !== "boolean") {
    throw new Error(
      `[pues/style] ${yamlPath} 'style.screen' must be a boolean.`,
    );
  }

  return {
    dark,
    light,
    vars,
    css: raw.css as string | undefined,
    reset: raw.reset as boolean | undefined,
    screen: raw.screen as boolean | undefined,
  };
}

function parseOverrides(
  path: string,
  which: "dark" | "light",
  raw: unknown,
): StyleOverrides | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") {
    throw new Error(
      `[pues/style] ${path} 'style.${which}' must be a map of token → CSS color.`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const out: StyleOverrides = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!(TOKEN_NAMES as readonly string[]).includes(k)) {
      throw new Error(
        `[pues/style] ${path} 'style.${which}.${k}': unknown token. ` +
          `Valid: ${TOKEN_NAMES.join(", ")}.`,
      );
    }
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(
        `[pues/style] ${path} 'style.${which}.${k}' must be a non-empty CSS color string.`,
      );
    }
    out[k as TokenName] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseVars(
  path: string,
  raw: unknown,
): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") {
    throw new Error(
      `[pues/style] ${path} 'style.vars' must be a map of name → value.`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(
        `[pues/style] ${path} 'style.vars.${k}' must be a non-empty string.`,
      );
    }
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
