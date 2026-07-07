import { type ReactNode, useState } from "react";
import { SettingsDialog } from "./SettingsDialog";

export type SettingsProps = {
  /** App-specific settings sections, rendered in the dialog above the default
   * Logout footer. */
  children?: ReactNode;
  /** Dialog heading. Defaults to "Settings". */
  title?: ReactNode;
  /** Button label. Defaults to "Settings". */
  label?: ReactNode;
  /** Passed to the dialog's default <Logout>. */
  logoutEndpoint?: string;
};

/**
 * Fixed bottom-left "Settings" link — the screen-dock counterpart of <Logout>
 * (`.pues-settings` mirrors `.pues-logout`). Tapping it opens <SettingsDialog>,
 * which carries a Logout at its own bottom-left by default. On mobile this lets
 * one dock slot stand in for both: Settings out front, Logout one tap in.
 *
 * Self-contained like <Logout> — drop it in and pass your settings sections as
 * `children`.
 */
export function Settings({
  children,
  title,
  label = "Settings",
  logoutEndpoint,
}: SettingsProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="pues-settings pues-shadow"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open ? (
        <SettingsDialog
          onClose={() => setOpen(false)}
          title={title}
          logoutEndpoint={logoutEndpoint}
        >
          {children}
        </SettingsDialog>
      ) : null}
    </>
  );
}
