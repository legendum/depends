# Forms — `pues/base/forms`

Styled, client-safe form controls — one consistent look for inputs across the
fleet.

## Provides
React components only — see **Components** below. Appearance comes from
`base/style` (override via your `main.css`, not by forking the components).

## Components
From `pues/base/forms`:
- `Button` (`ButtonProps`, `ButtonVariant`) — the standard button
- `Picker` (`PickerOption`, `PickerProps`) — segmented / option picker
- `Select` (`SelectOption`, `SelectProps`) — dropdown select
- `TextArea` (`TextAreaProps`) — multi-line text input
- `TextInput` (`TextInputProps`) — single-line text input

## Config
None.

## Routes / mounts / interfaces
None.

## Consume it
```ts
import { Button, TextInput } from "pues/base/forms";
```

## Notes
Client React components; appearance comes from `base/style` (override via your
`main.css`, not by forking the components).
