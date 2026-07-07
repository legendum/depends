export type LegendumProps = any;
export const Legendum: any;
export type LoginScreenProps = {
  tagline: any;
  appName?: string;
  logoSrc?: string;
  className?: string;
  logoClassName?: string;
  legendumClassName?: string;
  returnTo?: string;
  returnToCurrent?: boolean;
};
export function LoginScreen(props: LoginScreenProps): any;
export type LogoutProps = {
  endpoint?: string;
  fetch?: typeof fetch;
  variant?: "fixed" | "inline";
};
export function Logout(props?: LogoutProps): any;
export type SettingsProps = {
  children?: any;
  title?: any;
  label?: any;
  logoutEndpoint?: string;
};
export function Settings(props?: SettingsProps): any;
export type SettingsDialogProps = {
  onClose: () => void;
  children?: any;
  title?: any;
  logoutEndpoint?: string;
};
export function SettingsDialog(props: SettingsDialogProps): any;
export function useUser(opts?: { fetch?: typeof fetch }): {
  user: any;
  loading: boolean;
  setUser: (user: any) => void;
  refetch: () => Promise<void>;
};
