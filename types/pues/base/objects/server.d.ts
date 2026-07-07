// Type surface for `pues/base/objects/server`. The runtime barrel
// (base/objects/server.ts) re-exports only the React-free server files; this
// stub re-exports the full declared surface from index.d.ts so consumers
// typecheck against the declarations (not the impl), exactly as they do for the
// default barrel. Importing `/server` at runtime stays React-free regardless.
export * from "./index";
