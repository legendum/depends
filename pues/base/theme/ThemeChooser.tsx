import { useState } from "react";
import { usePuesFetch } from "../core/Pues";
import { Picker } from "../forms";
import { getThemePref, setThemePref, type ThemePref } from "./state";

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export type ThemeChooserProps = {
  /** Persistence endpoint for the theme PATCH. Defaults to `/pues/me`
   * (the v0.8.0 pues namespace convention — see SPEC §3.X). Pass `null`
   * to opt out of server persistence entirely (localStorage only — for
   * anonymous-visitor branches). Override with a custom path for
   * pre-v0.8.0 consumers that have not yet adopted the auth part. */
  endpoint?: string | null;
  /** Override the `fetch` implementation for the persistence PATCH. Falls
   * back to the value supplied via `<Pues fetch={...}>`, then to the
   * global `fetch`. Most consumers wrap their app in `<Pues>` and leave
   * this unset. */
  fetch?: typeof fetch;
};

export function ThemeChooser({
  endpoint = "/pues/me",
  fetch: fetchOverride,
}: ThemeChooserProps) {
  const fetchImpl = usePuesFetch(fetchOverride);
  const [pref, setPref] = useState<ThemePref>(() => getThemePref());

  function choose(next: ThemePref) {
    setPref(next);
    setThemePref(next);
    if (endpoint) {
      fetchImpl(endpoint, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta: { theme: next } }),
      }).catch(() => null);
    }
  }

  return (
    <div className="pues-theme-dock">
      <p className="pues-theme-dock-label">Theme</p>
      <Picker
        legend="Color theme"
        value={pref}
        onChange={(next) => choose(next as ThemePref)}
        options={OPTIONS}
      />
    </div>
  );
}
