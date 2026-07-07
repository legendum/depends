import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary";

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  /** Pending state: disables the button (so a slow action can't be
   *  double-fired) and, if `busyLabel` is given, swaps the label for it. */
  busy?: boolean;
  /** Label shown while `busy` — the per-action gerund, e.g. "Saving…". When
   *  omitted, the children stay put and only the disable applies. */
  busyLabel?: ReactNode;
  /** `"secondary"` adds `pues-btn-secondary` (the quieter cancel/dismiss look);
   *  defaults to the filled primary. */
  variant?: ButtonVariant;
  children: ReactNode;
};

/** The app's standard action button: a native `<button>` wearing `pues-btn`.
 *  Owns the busy-submit idiom — `busy` disables and (with `busyLabel`) swaps
 *  the label — so call sites stop hand-rolling
 *  `disabled={busy} {busy ? "…" : "…"}`. Any `disabled` you pass is OR-ed with
 *  `busy` (a validity gate still disables), `className` is appended, and the
 *  type defaults to `"button"` (pass `type="submit"` for a real form submit).
 *  For chrome stripped to the metal (tabs, icon buttons, copy handles) use the
 *  `pues-btn-reset` class directly — that's not this primitive. */
export function Button({
  busy = false,
  busyLabel,
  variant = "primary",
  disabled,
  className,
  type,
  children,
  ...rest
}: ButtonProps) {
  const classes = ["pues-btn"];
  if (variant === "secondary") classes.push("pues-btn-secondary");
  if (className) classes.push(className);
  return (
    <button
      {...rest}
      type={type ?? "button"}
      className={classes.join(" ")}
      disabled={busy || disabled}
    >
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}
