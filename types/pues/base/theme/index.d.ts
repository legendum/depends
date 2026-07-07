import type { Database } from "bun:sqlite";

export type ThemePref = "system" | "dark" | "light";

export type ThemeChooserProps = {
  endpoint?: string | null;
  fetch?: typeof fetch;
};

export function getTheme(db: Database, userId: number): ThemePref | null;
export function setTheme(db: Database, userId: number, value: ThemePref): void;
export function reconcileTheme(serverPref: unknown): void;
export function ThemeChooser(props: ThemeChooserProps): any;
