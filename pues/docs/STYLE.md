# Style — `pues/base/style`

The design-token + CSS foundation. `pues.css` bakes the token palette
(`tokens.ts`) plus component styles (`defaults.css`); consumers override sparsely
via `config/pues.yaml`, never by forking.

## Provides
From `pues/base/style`:
- `buildStyle(...)` (`BuildStyleArgs`, `BuildStyleResult`) — build `pues.css` from
  tokens + config
- `readStyleConfig(root)` (`StyleConfig`, `StyleOverrides`) — read the `style:` block
- `DEFAULT_TOKENS`, `TOKEN_NAMES` (`TokenName`), `Palette`, `cssVarName` — the
  token vocabulary
- ships `defaults.css` (component styles, `.pues-*` classes)

## Config
`config/pues.yaml` under `style:` (all optional; absent → pues defaults verbatim):
- `dark` / `light` — sparse token overrides (any subset of `TOKEN_NAMES`) →
  `:root` / `[data-theme="light"]`
- `vars` — extra `--pues-*` knobs (keys verbatim, including the `pues-` prefix)
- `css` — literal CSS appended after defaults (escape hatch)
- app-shell base reset is **default-on** (`--pues-topbar-height` default `65px`);
  set `false` to opt out

## Routes / mounts / interfaces
The `--pues-*` **CSS custom-property vocabulary** (`TOKEN_NAMES` + the `--pues-*`
knobs) is the theming interface: consumers restyle by overriding these in their
own `main.css` (cascade — `pues.css` first, `main.css` wins). `buildStyle` emits
the app's `pues.css`.

## Consume it
Build-time: your build script calls `buildStyle()`, which emits
**`<root>/public/dist/pues.css`** (link it from your HTML `<head>`). Import the
vocabulary only if you need tokens in code:
```ts
import { buildStyle } from "pues/base/style";     // build script
buildStyle();                                     // → public/dist/pues.css
import { DEFAULT_TOKENS, cssVarName } from "pues/base/style";  // optional, in-code
```

## Notes
Override in the consumer's `main.css`; never fork `defaults.css`. `style` reads
`config/pues.yaml` directly, so vendoring it doesn't force vendoring `objects`.
`base/pwa` reads `style.dark.bg_page` / `style.dark.chrome` as PWA manifest
fallbacks.
