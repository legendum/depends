import type { TextareaHTMLAttributes } from "react";

export type TextAreaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  /** Current text (controlled). */
  value: string;
  /** Called with the new text — the unwrapped `e.target.value`, so callers
   *  rarely need the raw event. */
  onChange: (value: string) => void;
};

/** A native `<textarea>` carrying `pues-textarea`, which exists only to undo the
 *  element's divergent browser defaults: it grows vertically (not both axes) and
 *  inherits the UI font (a textarea otherwise falls back to monospace). Like
 *  `Select`, it styles the field's *behaviour*, not its box — compose your own
 *  field-box class alongside it for the border/background, e.g.
 *  `<TextArea className="input" …>`, so it matches its sibling text inputs. Any
 *  extra `className` is appended; all other native `<textarea>` props pass
 *  through. */
export function TextArea({
  value,
  onChange,
  className,
  ...rest
}: TextAreaProps) {
  return (
    <textarea
      {...rest}
      className={className ? `pues-textarea ${className}` : "pues-textarea"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
