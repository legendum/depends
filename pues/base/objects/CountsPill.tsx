/**
 * A compact read-only breakdown pill: a row of tiny letters over a row of
 * counts, one column per cell (e.g. `T L D F S` over `3 1 9 0 2`). Display-only;
 * pair with `<FilterChips>` for the interactive version. Replaces the per-app
 * copies (loggers `LevelCountsPill`, fifos `StatusCountsPill`), which already
 * shared identical markup.
 *
 * Theming is the consumer's: each value carries `pues-counts__value--<key>`, so an
 * app colours its own categories there. Scales to any number of cells (the grid
 * template is computed from `cells.length`).
 */

import { Fragment } from "react";

export type CountsPillCell<K extends string> = {
  key: K;
  /** The single-character header shown above the value (e.g. "E" for error). */
  letter: string;
};

export type CountsPillProps<K extends string> = {
  cells: ReadonlyArray<CountsPillCell<K>>;
  counts: Record<K, number>;
};

export function CountsPill<K extends string>({
  cells,
  counts,
}: CountsPillProps<K>) {
  // value | sep | value | sep | … — N value columns + (N-1) separators.
  const template = cells.map(() => "minmax(0, 1fr)").join(" auto ");
  return (
    <span
      className="pues-counts"
      style={{ gridTemplateColumns: template }}
      title={cells.map((c) => `${c.key} ${counts[c.key] ?? 0}`).join(" · ")}
    >
      {cells.map((c, i) => (
        <Fragment key={`l-${c.key}`}>
          {i > 0 && <span className="pues-counts__sep" aria-hidden />}
          <span className="pues-counts__letter" title={c.key}>
            {c.letter}
          </span>
        </Fragment>
      ))}
      {cells.map((c, i) => (
        <Fragment key={`v-${c.key}`}>
          {i > 0 && (
            <span className="pues-counts__sep" aria-hidden>
              {"•"}
            </span>
          )}
          <span className={`pues-counts__value pues-counts__value--${c.key}`}>
            {counts[c.key] ?? 0}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
