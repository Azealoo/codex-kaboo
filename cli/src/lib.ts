/**
 * The collector's library surface, for in-repo consumers that need its parser and plumbing without
 * shelling out to the binary — today that is `desktop/`, the menu bar card.
 *
 * Why a second entry rather than deep imports: `desktop/` bundles from source at build time, so a
 * deep import would work and then quietly rot the first time a file moves. Naming the surface here
 * makes "what the card is allowed to depend on" a reviewable list, and keeps `main.ts` free to
 * refactor everything it does not name.
 *
 * Deliberately NOT a tsup entry. `desktop/` imports this source through a tsconfig path alias, the
 * same way `web` consumes `shared` and `convex`, and bundles it itself. Emitting a `dist/lib.js`
 * would add ~150 KB of never-imported code to every `npm i -g` of the collector to serve a consumer
 * that is in this repo anyway.
 */

// Where state lives, and how to read it.
export { kabooHome, kabooPaths, defaultCodexHome, resolveCodexHomes } from "./core/paths";
export type { KabooPaths } from "./core/paths";
export { readConfig, writeJsonAtomic } from "./core/config";
export { readState } from "./core/state";
export type { Config, FileState, SyncState } from "./types";

// The single-writer lock. A second process that writes state.json without taking this corrupts it,
// so anything in this repo that syncs goes through `acquireLock` — see runSync's own use.
export { acquireLock, readLock, releaseLock } from "./util/lock";
export type { LockInfo, LockOptions, LockResult } from "./util/lock";

// Discovery + the incremental parser, which is what makes a live TPS sampler cheap: the same
// reducer that `sync` uses can be fed appended lines and asked for the events they produced.
export { discoverRolloutFiles, parseRolloutName, dedupeBySession } from "./core/discover";
export type { DiscoveredFile, DiscoverResult, RolloutName } from "./core/discover";
export { parseRolloutFile } from "./core/parse-file";
export type { ParseFileOptions, ParseFileResult } from "./core/parse-file";
export { createReducerState, reduceLine, finalize } from "./parser/session";
export type { ParsedSession, ReducerContext, ReducerState } from "./parser/session";
export { machineZone } from "./parser/time";

// Talking to the dashboard, and running a sync on demand.
export { createClient, isAuthError, SyncHttpError, SyncNetworkError } from "./upload/client";
export type { SyncClient } from "./upload/client";
export { runSync } from "./commands/sync";
export type { SyncDeps, SyncOptions, SyncReport } from "./commands/sync";

export { CLI_VERSION } from "./build-info";
