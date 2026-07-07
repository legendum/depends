export type Row<T extends Record<string, unknown> = Record<string, unknown>> = {
  id: string | number;
  label?: string;
  position: number;
  parent_id?: string | number;
  updated_at?: number | string;
  created_at?: number | string;
  meta?: Record<string, unknown>;
  slug?: string;
} & T;

export type CountsRow = {
  parent_id: string | number | null;
  value: string;
  n: number;
  [key: string]: unknown;
};

export type UseResourceResult<T = Row> = {
  rows: T[];
  loading: boolean;
  error: Error | null;
  mutate: (next: T[] | ((prev: T[]) => T[])) => void;
  reload: () => void;
  loadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  newOpId: () => string;
};

export function AddButton(props: {
  onCreated?: (row: Row) => void;
  [key: string]: unknown;
}): any;
export const Dialog: any;
export const DragHandle: any;
export type CountsPillCell<K extends string = string> = {
  key: K;
  letter: string;
};
export type CountsPillProps<K extends string = string> = any;
export const CountsPill: any;
export type FilterChipOption<K extends string = string> = {
  key: K;
  label?: any;
};
export type FilterChipsProps<K extends string = string> = any;
export const FilterChips: any;
export const FilterBar: any;
export const LogoButton: any;
export const useLogoButton: any;
export const ObjectDetail: any;
export const RenameTitle: any;
export type TabItem<T extends string = string> = {
  id: T;
  label?: any;
  dot?: boolean;
};
export type TabStripProps<T extends string = string> = any;
export const TabStrip: any;
export const TopBar: any;

export function broadcastRow(...args: any[]): any;
export function broadcastDelete(...args: any[]): any;
export function toWire(...args: any[]): any;
export function loadPuesConfig(...args: any[]): any;
export function resolveColumns(...args: any[]): any;

export type AuthPolicy = "user" | "public";
export type AuthConfig = { get?: AuthPolicy; write?: AuthPolicy };

export type ResolveUserFn = (
  req: Request,
) => Promise<number | null> | number | null;

export type Broadcast = (
  userId: number,
  event: string,
  data: unknown,
  opts?: { op_id?: string | null },
) => void;

export type Handler = (
  req: Request & { params?: Record<string, string> },
) => Promise<Response> | Response;

export type RouteMap = Record<string, Record<string, Handler>>;

export type BeforeInsertContext = {
  body: Record<string, unknown>;
  userId: number;
  cols: Record<string, unknown>;
};
export type BeforeInsertHook = (
  ctx: BeforeInsertContext,
) =>
  | Record<string, unknown>
  | Response
  | Promise<Record<string, unknown> | Response>;
export type BeforeUpdateContext = {
  body: Record<string, unknown>;
  existing: Record<string, unknown>;
  userId: number;
  cols: Record<string, unknown>;
};
export type BeforeUpdateHook = (
  ctx: BeforeUpdateContext,
) =>
  | Record<string, unknown>
  | Response
  | Promise<Record<string, unknown> | Response>;
export type BeforeDeleteContext = {
  existing: Record<string, unknown>;
  userId: number;
  cols: Record<string, unknown>;
};
export type BeforeDeleteHook = (
  ctx: BeforeDeleteContext,
) => undefined | Response | Promise<undefined | Response>;

export type MountResourceArgs = {
  db: import("bun:sqlite").Database | (() => import("bun:sqlite").Database);
  name: string;
  config: Record<string, unknown>;
  parentCols?: Record<string, unknown>;
  resolveUser?: ResolveUserFn;
  auth?: AuthConfig;
  broadcast?: Broadcast;
  newId?: () => string;
  /** Override slug derivation from the source string; the result is
   * normalized through `toSlug`. Default: `toSlug`. */
  deriveSlug?: (source: string) => string;
  beforeInsert?: BeforeInsertHook;
  beforeUpdate?: BeforeUpdateHook;
  beforeDelete?: BeforeDeleteHook;
};

export function mountResource(args: MountResourceArgs): RouteMap;

export function useCounts<T extends CountsRow = CountsRow>(...args: any[]): {
  rows: T[];
  [key: string]: unknown;
};
export function useDelete<T = Row>(...args: any[]): {
  del: (id: any) => any;
  [key: string]: unknown;
};
export function useDndPositions<T = Row>(...args: any[]): {
  onDragEnd: (event: any) => void;
  itemIds: string[];
  [key: string]: unknown;
};
export function useEscape(...args: any[]): any;
export function useFilter<T>(
  rows: T[],
  query: string,
  matcher: (row: T, query: string) => boolean,
): { active: boolean; visibleRows: T[] };
export function useFilterEnter(opts: {
  inputRef?: import("react").RefObject<HTMLInputElement | null>;
  active: boolean;
  onEnter: () => void;
}): void;
export function useFilterQuery(...args: any[]): [string, (value: any) => void];
export function useFocusFilter(
  inputRef:
    | import("react").RefObject<HTMLInputElement | null>
    | undefined,
  opts?: { active?: boolean },
): void;
export type UseListKeyboardNavOptions<T> = {
  rows: T[];
  active: boolean;
  onActivate: (row: T) => void;
  filterInputRef?: import("react").RefObject<HTMLInputElement | null>;
  resetKey?: unknown;
};
export type UseListKeyboardNavResult = { highlight: number };
export function useListKeyboardNav<T>(
  opts: UseListKeyboardNavOptions<T>,
): UseListKeyboardNavResult;
export type LongPressHandlers = {
  onPointerDownCapture: (e: import("react").PointerEvent) => void;
  onPointerMoveCapture: (e: import("react").PointerEvent) => void;
  onPointerUpCapture: (e: import("react").PointerEvent) => void;
  onPointerCancelCapture: (e: import("react").PointerEvent) => void;
};
export function useLongPress(options: {
  enabled?: boolean;
  durationMs?: number;
  moveThresholdPx?: number;
  ignoreSelectors?: string[];
  onLongPress: () => void;
}): LongPressHandlers;
export function useRename<T = Row>(...args: any[]): {
  rename: (id: any, label: string, extra?: Record<string, unknown>) => any;
  [key: string]: unknown;
};
export function useResource<T = Row>(...args: any[]): UseResourceResult<T>;
export type OfflineRowCache<Cached = Row> = {
  write: (rows: Cached[]) => Promise<void>;
  read: () => Promise<Cached[] | null>;
  findBy: <K extends keyof Cached>(
    field: K,
    value: Cached[K],
  ) => Promise<Cached | null>;
};
export type UseOfflineRowCacheOptions<T = Row, Cached = T> = {
  dbName: string;
  metaKey: string;
  project?: (row: T) => Cached;
  enabled?: boolean;
};
export function createOfflineRowCache<T = Row, Cached = T>(opts: {
  dbName: string;
  metaKey: string;
  project?: (row: T) => Cached;
}): OfflineRowCache<Cached>;
export function useOfflineRowCache<T = Row, Cached = T>(
  resource: UseResourceResult<T>,
  options: UseOfflineRowCacheOptions<T, Cached>,
): OfflineRowCache<Cached>;
export function useSlugRouting<T = Row>(opts: {
  resource: UseResourceResult<T>;
  enabled: boolean;
  excludePathPrefixes?: string[];
  resolveExternal?: (slug: string) => Promise<T | null>;
  onSlugChanged?: (oldSlug: string, newSlug: string) => void;
}): {
  selected: T | null;
  select: (row: T) => void;
  goBack: () => void;
  filterQuery: string;
  setFilterQuery: (next: string | ((prev: string) => string)) => void;
};
export function resolveSlugSelection<R = Row>(opts: {
  rows: R[];
  slug: string | null;
  currentSelectedId: string | number | null;
}):
  | { action: "clear" }
  | { action: "hold" }
  | { action: "select"; row: R; replaceUrl: string | null };
export function getSlugFromPath(excludePathPrefixes?: string[]): string | null;
export function toSlug(label: string): string;
export function useSwipeToReveal(...args: any[]): any;
