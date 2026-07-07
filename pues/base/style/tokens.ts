/**
 * Baked-in defaults for every theme token pues ships. The single source
 * of truth — `buildStyle` reads these, overlays any `style.dark` /
 * `style.light` overrides from pues.yaml, and emits the `:root` +
 * `[data-theme="light"]` blocks at the top of the generated pues.css.
 *
 * Token vocabulary is closed: adding a token is a pues version bump
 * (every consumer's defaults.css can now reference the new name).
 * Removing one is a breaking change for any consumer using the
 * generated pues.css.
 *
 * Names are in YAML form (snake_case). The CSS variable name is
 * `--pues-<kebab>` — `bg_page` → `--pues-bg-page`. The mapping is
 * mechanical (replace `_` with `-`), implemented in buildStyle.
 */

export const TOKEN_NAMES = [
  "bg_page",
  "bg_surface",
  "bg_raised",
  "bg_raised_hover",
  "text_primary",
  "text_body",
  "text_secondary",
  "text_muted",
  "text_faint",
  "border_default",
  "border_strong",
  "accent",
  "accent_hover",
  "accent_light",
  "accent_glow",
  "danger",
  "danger_hover",
  "danger_active",
  "danger_text",
  "success",
  "on_accent",
  "shadow_sm",
  "shadow_md",
  "shadow_lg",
  "shadow_xl",
  "overlay",
  /** Browser-chrome paint — what the PWA manifest's `theme_color` reads.
   * Defaults to match `bg_page` so the topbar visually continues into
   * the address bar; override when the chrome surface differs. */
  "chrome",
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];
export type Palette = Record<TokenName, string>;

// `base/pwa/config.ts` imports `DEFAULT_TOKENS.dark.bg_page` and
// `DEFAULT_TOKENS.dark.chrome` for PWA manifest fallback — vendoring
// `pwa` implies also vendoring `style`.
export const DEFAULT_TOKENS: { dark: Palette; light: Palette } = {
  dark: {
    bg_page: "#0f172a",
    bg_surface: "#1e293b",
    bg_raised: "#334155",
    bg_raised_hover: "#475569",
    text_primary: "#e2e8f0",
    text_body: "#cbd5e1",
    text_secondary: "#94a3b8",
    text_muted: "#64748b",
    text_faint: "#475569",
    border_default: "#334155",
    border_strong: "#475569",
    accent: "#3b82f6",
    accent_hover: "#2563eb",
    accent_light: "#60a5fa",
    accent_glow: "rgba(59, 130, 246, 0.35)",
    danger: "#dc2626",
    danger_hover: "#ef4444",
    danger_active: "#b91c1c",
    danger_text: "#f87171",
    success: "#22c55e",
    on_accent: "#ffffff",
    shadow_sm: "rgba(0, 0, 0, 0.3)",
    shadow_md: "rgba(0, 0, 0, 0.35)",
    shadow_lg: "rgba(0, 0, 0, 0.4)",
    shadow_xl: "rgba(0, 0, 0, 0.5)",
    overlay: "rgba(0, 0, 0, 0.6)",
    chrome: "#0f172a",
  },
  light: {
    bg_page: "#f1f5f9",
    bg_surface: "#ffffff",
    bg_raised: "#e2e8f0",
    bg_raised_hover: "#cbd5e1",
    text_primary: "#0f172a",
    text_body: "#1e293b",
    text_secondary: "#475569",
    text_muted: "#64748b",
    text_faint: "#94a3b8",
    border_default: "#e2e8f0",
    border_strong: "#94a3b8",
    accent: "#2563eb",
    accent_hover: "#1d4ed8",
    accent_light: "#3b82f6",
    accent_glow: "rgba(37, 99, 235, 0.3)",
    danger: "#dc2626",
    danger_hover: "#ef4444",
    danger_active: "#b91c1c",
    danger_text: "#dc2626",
    success: "#16a34a",
    on_accent: "#ffffff",
    shadow_sm: "rgba(15, 23, 42, 0.08)",
    shadow_md: "rgba(15, 23, 42, 0.12)",
    shadow_lg: "rgba(15, 23, 42, 0.18)",
    shadow_xl: "rgba(15, 23, 42, 0.22)",
    overlay: "rgba(15, 23, 42, 0.4)",
    chrome: "#ffffff",
  },
};

/** YAML uses snake_case (`text_muted`); CSS uses kebab-case
 * (`text-muted`). Mapping is mechanical. */
export function cssVarName(token: string): string {
  return `--pues-${token.replace(/_/g, "-")}`;
}
