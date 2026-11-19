/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as lib_nums from "../lib/nums.js";
import type * as lib_planView from "../lib/planView.js";
import type * as lib_source from "../lib/source.js";
import type * as lib_summary from "../lib/summary.js";
import type * as migrations from "../migrations.js";
import type * as plans from "../plans.js";
import type * as strength from "../strength.js";
import type * as sync from "../sync.js";
import type * as training from "../training.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  "lib/nums": typeof lib_nums;
  "lib/planView": typeof lib_planView;
  "lib/source": typeof lib_source;
  "lib/summary": typeof lib_summary;
  migrations: typeof migrations;
  plans: typeof plans;
  strength: typeof strength;
  sync: typeof sync;
  training: typeof training;
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
