/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "./schema";

// Every module under convex/ (tests included; convex-test only loads what a function reference needs).
export const modules = import.meta.glob("./**/*.*s");

export function setup() {
  return convexTest(schema, modules);
}
export type Harness = ReturnType<typeof setup>;
