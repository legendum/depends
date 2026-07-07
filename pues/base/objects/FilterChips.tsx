/**
 * A row of filter chips — `All` plus one per option, each with a live count, the
 * active one highlighted; clicking an option toggles it (click again ⇒ back to
 * All). Controlled: the parent owns `active` and does the filtering.
 *
 * Theming is the consumer's: each chip carries a stable `pues-chip--<key>` class,
 * so an app colours its own states by overriding `.pues-chip--<key>.pues-chip--active`
 * (e.g. via CSS vars). Pues ships only the neutral skeleton + the default accent
 * fill. Replaces the per-app copies (loggers `logger-level-chips`, fifos
 * `status-chips`, dojos `StateChips`).
 */

import type { ReactNode } from "react";

export type FilterChipOption<K extends string> = {
  key: K;
  /** Visible label; defaults to the key. */
  label?: ReactNode;
};

export type FilterChipsProps<K extends string> = {
  options: ReadonlyArray<FilterChipOption<K>>;
  /** Count per option key; the `All` chip shows their sum. */
  counts: Record<K, number>;
  /** Selected key, or null for "All". */
  active: K | null;
  onChange: (next: K | null) => void;
  /** Label for the "show everything" chip. Defaults to "All". */
  allLabel?: ReactNode;
  /**
   * Whether to offer an "All" (null) option. Default true — clicking the active
   * chip toggles back to All. Set false for a **mandatory single-select** (always
   * exactly one active, no All chip, no toggle-off) — e.g. a view that's
   * paginated per category and can't show everything at once.
   */
  allowAll?: boolean;
};

export function FilterChips<K extends string>({
  options,
  counts,
  active,
  onChange,
  allLabel = "All",
  allowAll = true,
}: FilterChipsProps<K>) {
  const total = options.reduce((n, o) => n + (counts[o.key] ?? 0), 0);
  return (
    <div className="pues-chips">
      {allowAll && (
        <button
          type="button"
          className={`pues-chip pues-chip--all${active === null ? " pues-chip--active" : ""}`}
          onClick={() => onChange(null)}
        >
          {allLabel} <span className="pues-chip__count">{total}</span>
        </button>
      )}
      {options.map((o) => (
        <button
          type="button"
          key={o.key}
          className={`pues-chip pues-chip--${o.key}${active === o.key ? " pues-chip--active" : ""}`}
          // Mandatory mode: clicking always selects (never clears to null).
          onClick={() => onChange(allowAll && active === o.key ? null : o.key)}
        >
          {o.label ?? o.key}{" "}
          <span className="pues-chip__count">{counts[o.key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
