# SSE — `pues/base/sse`

Server-Sent Events fan-out plus the client hooks that consume it: live resource
streams, public/keyed channels, and a stale-while-revalidate fetch family. One
barrel (`pues/base/sse`) — the route factories are React-free but ship
alongside the hooks; import server functions and client hooks from the same
path (Bun tree-shakes the server side out of the client bundle).

## Provides
**Server route factories:**
- `sseRoute({ resolveUser, path?, ... })` → `{ routes, broadcast, streamCount }`
  — **Flavor A**, per-user authenticated stream (default `/api/events`).
  `broadcast(userId, event, data, { op_id })` fans out scoped to one user (no
  global broadcast by design — isolation by construction).
- `keyedSseRoute({ canSubscribe, batch?, ... })` →
  `{ subscribe, broadcast, streamCount, reset }` — **Flavor B**, streams
  addressed by an arbitrary key (a resource ULID). `canSubscribe(key, req)`
  authorizes each subscription (→403); `subscribe(req, key)` is called from your
  own routing after you extract the key.
- `broadcastChanged(broadcast, userId, surface, scope?)` — emit a payload-light
  `<surface>.changed` invalidation signal for non-row views.

**Client hooks:**
- `useSSE(handlers, opts)` — subscribe to the per-user stream, route named events
  to handlers, drop your own op_id echoes
- `useKeyedSSE(path, handlers, opts)` — client half of Flavor B (public by
  default; `onResync` to rebuild from REST)
- `useFetch(url, opts)` — SWR read into `loading/error/ready` `FetchState`;
  `useLiveFetch(url, { invalidatedBy, scope })` — `useFetch` + auto-refetch on
  `.changed`; `useInvalidation(surfaces, opts)` — per-surface refetch nonces

## Components
- `Fetched` (`FetchedProps`) — render a `FetchState<T>`: a placeholder while
  loading, a message on error, and `children(data)` once ready (the companion to
  `useFetch`)

## Config
None in `config/pues.yaml`. All tuning is per-call: `path`, `heartbeatMs`
(default 20s), `ringMax` (replay buffer, default 200; `0` disables replay),
`evictAfterMs` (idle-key grace, default 60s), and `batch` (per-event coalescing
for high-volume keyed channels). No env of its own.

## Routes / mounts / interfaces
The **SSE wire protocol** (owned by the internal `streamCore`): frames are
`event: <name>\nid: <n>\ndata: <json>`; reconnects send `Last-Event-ID` and get
strictly-newer ring frames replayed, or one synthetic `resync` event when the id
is outside the ring; `: ping` heartbeats keep the connection warm. **op_id
echo-suppression** (SPEC §7.2): a client mints an id via `newOpId()`, sends it
with its write, the server folds it into the broadcast frame (`{ op_id }`), and
the originating client drops that frame to keep its optimistic state. **Batching**
coalesces a named event into `{ items: [...] }` frames.

Flavor A mounts a route map (`{ "/api/events": { GET } }` to spread into
`Bun.serve`); Flavor B hands you `subscribe(req, key)` to call from your router
with the key you parsed from the path.

## Consume it
```ts
// server — per-user live resource stream
import { sseRoute } from "pues/base/sse";
const { routes, broadcast } = sseRoute({ resolveUser });
// pass `broadcast` to mountResource so writes fan out

// client — subscribe (usually transitively via useResource)
import { useSSE } from "pues/base/sse";
const { newOpId } = useSSE({ "fifos.created": (row) => addRow(row) });
```

## Notes
`broadcast` here is the same signature `base/objects`' `mountResource` expects —
wire `sseRoute().broadcast` straight in and resource mutations become live.
Prefer one top-level `useInvalidation` feeding many `useFetch(url, {deps})` over
one stream per view. `useInvalidation` deliberately mints **no** op_id (the actor
should refetch too) and treats `resync` as "refetch everything". All server
timers are `unref()`'d, so the core never keeps the process alive. Auto-pulls
`core` and `objects` (shares `ResolveUserFn` / `newId`). Full design:
`docs/pues/SPEC.md` §7.
