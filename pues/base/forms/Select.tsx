import type { SelectHTMLAttributes } from "react";

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange" | "children"
> & {
  /** Current selected value (controlled). */
  value: string;
  /** Called with the newly-selected value — the unwrapped `e.target.value`,
   *  so callers rarely need the raw event. */
  onChange: (value: string) => void;
  /** The choices, in render order. */
  options: SelectOption[];
};

/** A native `<select>` carrying the `pues-select` chevron (the part's whole
 *  reason to exist: it suppresses the platform arrow and paints a consistent
 *  one). `pues-select` styles only the dropdown affordance — compose your own
 *  field-box class alongside it for the border/background, e.g.
 *  `<Select className="input" …>`, so a select matches its sibling text inputs.
 *  Any extra `className` is appended; all other native `<select>` props pass
 *  through. */
export function Select({
  value,
  onChange,
  options,
  className,
  ...rest
}: SelectProps) {
  return (
    <select
      {...rest}
      className={className ? `pues-select ${className}` : "pues-select"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
