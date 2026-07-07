import type { InputHTMLAttributes } from "react";

export type TextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  /** Current text (controlled). */
  value: string;
  /** Called with the new text — the unwrapped `e.target.value`, so callers
   *  rarely need the raw event. */
  onChange: (value: string) => void;
};

/** A native single-line `<input>` whose only job is the `onChange(value)` unwrap
 *  — the same idiom as `Select` and `TextArea`, so every controlled field in the
 *  part reads the same. Unlike those two it ships no class of its own: a text
 *  input has no divergent browser default to fix, so the box (border/background)
 *  comes entirely from a composed field class, e.g. `<TextInput className="input"
 *  …>`. All native `<input>` props pass through — `type`, `inputMode`,
 *  `onKeyDown`, etc. Value-based only: for a checkbox/radio (state in `checked`)
 *  reach for a native `<input>`, not this. */
export function TextInput({ value, onChange, ...rest }: TextInputProps) {
  return (
    <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} />
  );
}
