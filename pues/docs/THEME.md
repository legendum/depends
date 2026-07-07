# Theme — `pues/base/theme`

Light / dark / system theme: the chooser UI, client-side application to the DOM,
and per-user server persistence.

## Provides
- Client (`pues/base/theme`): `reconcileTheme(serverPref)` — adopt a server-sent
  pref unless the user has already chosen locally; `ThemePref`
  (`"system" | "dark" | "light"`).
- Server (`pues/base/theme/server`): `getTheme(db, userId)` /
  `setTheme(db, userId, pref)` — persist the per-user preference.

## Components
- `ThemeChooser` (`ThemeChooserProps`) — the light / dark / system picker
  (client)

## Config
None. The client pref lives in `localStorage["pues.theme"]`; the per-user pref
lives in your DB (via `getTheme` / `setTheme`).

## Routes / mounts / interfaces
None. Applies the theme by setting `data-theme` on `<html>` (following
`prefers-color-scheme` when `system`).

## Consume it
```ts
import { ThemeChooser, reconcileTheme } from "pues/base/theme";   // client
import { getTheme, setTheme } from "pues/base/theme/server";       // server
```

## Notes
`reconcileTheme` is a no-op once the user has toggled the chooser, so a stale
server value can't override an explicit local choice.
