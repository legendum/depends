export type Broadcast = (
  userId: number,
  event: string,
  data: unknown,
  opts?: { op_id?: string | null },
) => void;

export function sseRoute(...args: any[]): {
  routes: Record<string, unknown>;
  broadcast: Broadcast;
  streamCount: () => number;
};

export function broadcastChanged(
  broadcast: Broadcast,
  userId: number,
  surface: string,
  scope?: string | number | null,
): void;

export type BatchPolicy = {
  windowMs: number;
  maxEvents?: number;
};

export type CanSubscribe = (
  key: string,
  req: Request,
) => boolean | Promise<boolean>;

export type KeyedSseRouteArgs = {
  canSubscribe: CanSubscribe;
  heartbeatMs?: number;
  ringMax?: number;
  evictAfterMs?: number;
  batch?: Record<string, BatchPolicy>;
};

export type KeyedSseRouteResult = {
  subscribe: (req: Request, key: string) => Promise<Response>;
  broadcast: (
    key: string,
    event: string,
    data: unknown,
    opts?: { op_id?: string | null },
  ) => void;
  streamCount: () => number;
  reset: () => void;
};

export function keyedSseRoute(args: KeyedSseRouteArgs): KeyedSseRouteResult;

export type ScopeValue = string | number | null;

export type UseInvalidationOptions = {
  scope?: ScopeValue;
  path?: string;
  enabled?: boolean;
};

export function invalidationScopeMatches(
  data: unknown,
  scope: ScopeValue | undefined,
): boolean;

export function useInvalidation(
  surfaces: readonly string[],
  options?: UseInvalidationOptions,
): Record<string, number>;

export type FetchState<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

export type FetchedProps<T> = {
  state: FetchState<T>;
  label?: string;
  loading?: any;
  error?: (message: string) => any;
  children: (data: T) => any;
};

export function Fetched<T>(props: FetchedProps<T>): any;

export type UseFetchOptions = {
  deps?: readonly unknown[];
  enabled?: boolean;
};

export function reduceFetchState<T>(
  prev: FetchState<T>,
  outcome: { ok: true; data: T } | { ok: false; message: string },
): FetchState<T>;

export function useFetch<T>(
  url: string,
  options?: UseFetchOptions,
): [
  FetchState<T>,
  (next: FetchState<T> | ((prev: FetchState<T>) => FetchState<T>)) => void,
];

export type UseLiveFetchOptions = {
  invalidatedBy?: string | readonly string[];
  scope?: ScopeValue;
  path?: string;
  enabled?: boolean;
};

export function useLiveFetch<T>(
  url: string,
  options?: UseLiveFetchOptions,
): [
  FetchState<T>,
  (next: FetchState<T> | ((prev: FetchState<T>) => FetchState<T>)) => void,
];

export type KeyedSseHandler = (
  data: unknown,
  opts: { op_id: string | null },
) => void;

export type UseKeyedSSEOptions = {
  enabled?: boolean;
  withCredentials?: boolean;
  onResync?: () => void;
};

export type UseKeyedSSEResult = {
  newOpId: () => string;
  forgetOpId: (opId: string) => void;
};

export function useKeyedSSE(
  path: string | null,
  handlers: Record<string, KeyedSseHandler>,
  options?: UseKeyedSSEOptions,
): UseKeyedSSEResult;

export type SseEventHandler = (
  data: unknown,
  opts: { op_id: string | null },
) => void;

export type UseSSEOptions = {
  path?: string;
  enabled?: boolean;
};

export type UseSSEResult = {
  newOpId: () => string;
  forgetOpId: (opId: string) => void;
};

export function useSSE(
  handlers: Record<string, SseEventHandler>,
  options?: UseSSEOptions,
): UseSSEResult;
