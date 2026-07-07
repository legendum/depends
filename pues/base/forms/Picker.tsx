export type PickerOption = {
  value: string;
  label: string;
};

export type PickerProps = {
  /** Current selected value (controlled). */
  value: string;
  /** Called with the newly-picked value. */
  onChange: (value: string) => void;
  /** The rungs, in render order. */
  options: PickerOption[];
  /** Accessible name for the group — rendered as a visually-hidden `<legend>`,
   *  so a screen reader announces "Color theme, group" before the options. */
  legend: string;
  /** Appended to the fieldset's `pues-picker` class for the rare local tweak
   *  (e.g. sizing it to its rungs). The pill look — track, options, shadow,
   *  pressed state — is the part's, not the caller's. */
  className?: string;
};

/** A segmented control: a pill of mutually-exclusive options where the selected
 *  rung is filled (`aria-pressed`). The generalization of ThemeChooser — supply
 *  any `options` + `legend`. A `<fieldset>` of `<button>`s, so it's a single
 *  labelled group to assistive tech and never submits a form. */
export function Picker({
  value,
  onChange,
  options,
  legend,
  className,
}: PickerProps) {
  return (
    <fieldset
      className={className ? `pues-picker ${className}` : "pues-picker"}
    >
      <legend className="pues-sr-only">{legend}</legend>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="pues-picker-option"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </fieldset>
  );
}
