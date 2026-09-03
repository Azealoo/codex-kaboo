/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as lib_aggregate from "../lib/aggregate.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_cost from "../lib/cost.js";
import type * as lib_days from "../lib/days.js";
import type * as lib_hash from "../lib/hash.js";
import type * as lib_http from "../lib/http.js";
import type * as lib_periods from "../lib/periods.js";
import type * as lib_quota from "../lib/quota.js";
import type * as lib_types from "../lib/types.js";
import type * as lib_validators from "../lib/validators.js";
import type * as machines from "../machines.js";
import type * as prices from "../prices.js";
import type * as rollups from "../rollups.js";
import type * as sessions from "../sessions.js";
import type * as stats from "../stats.js";
import type * as summary from "../summary.js";
import type * as syncTokens from "../syncTokens.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  http: typeof http;
  ingest: typeof ingest;
  "lib/aggregate": typeof lib_aggregate;
  "lib/auth": typeof lib_auth;
  "lib/constants": typeof lib_constants;
  "lib/cost": typeof lib_cost;
  "lib/days": typeof lib_days;
  "lib/hash": typeof lib_hash;
  "lib/http": typeof lib_http;
  "lib/periods": typeof lib_periods;
  "lib/quota": typeof lib_quota;
  "lib/types": typeof lib_types;
  "lib/validators": typeof lib_validators;
  machines: typeof machines;
  prices: typeof prices;
  rollups: typeof rollups;
  sessions: typeof sessions;
  stats: typeof stats;
  summary: typeof summary;
  syncTokens: typeof syncTokens;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
