export const COLORS = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
};

export function colorState(state: string): string {
  const color = COLORS[state as keyof typeof COLORS] ?? "";
  const symbol = state === "green" ? "●" : state === "yellow" ? "●" : "●";
  return `${color}${symbol} ${state}${COLORS.reset}`;
}
