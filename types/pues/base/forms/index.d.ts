import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
} & Record<string, any>;

export function Select(props: SelectProps): any;

export type TextAreaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
};

export function TextArea(props: TextAreaProps): any;

export type TextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
};

export function TextInput(props: TextInputProps): any;

export type PickerOption = {
  value: string;
  label: string;
};

export type PickerProps = {
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  legend: string;
  className?: string;
};

export function Picker(props: PickerProps): any;

export type ButtonVariant = "primary" | "secondary";

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  busy?: boolean;
  busyLabel?: ReactNode;
  variant?: ButtonVariant;
  children: ReactNode;
};

export function Button(props: ButtonProps): any;
