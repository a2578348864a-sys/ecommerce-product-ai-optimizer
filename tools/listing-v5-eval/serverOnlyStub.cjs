// Intentionally empty module.
//
// `server-only` is a Next.js build-time alias package. It is not installed in
// this workspace, so importing lib/server/aiClient.ts under plain node/tsx
// fails with MODULE_NOT_FOUND. The Listing V5 benchmark tooling maps the
// specifier here before the pipeline is loaded. Next.js itself keeps using its
// own alias, so this file never affects the application build.
