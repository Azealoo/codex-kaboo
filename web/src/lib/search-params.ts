import { createSerializer, parseAsString, parseAsStringLiteral } from "nuqs/server";
import { DEFAULT_PRESET, PRESETS, isCustom, type Preset, type RangeParams } from "./range";

export const SECTIONS = ["users", "models", "tools", "projects", "skills"] as const;
export type Section = (typeof SECTIONS)[number];
export const VIEWS = ["volume", "efficiency"] as const;
export type View = (typeof VIEWS)[number];
export const TABS = ["overview", "breakdown", "efficiency", "sessions"] as const;
export type Tab = (typeof TABS)[number];

const push = { history: "push" as const };

export const rangeParsers = {
  range: parseAsStringLiteral(PRESETS)
    .withDefault(DEFAULT_PRESET)
    .withOptions({ ...push, clearOnDefault: false }),
  from: parseAsString.withOptions(push),
  to: parseAsString.withOptions(push),
};

export const sectionParser = parseAsStringLiteral(SECTIONS).withDefault("users").withOptions(push);
export const viewParser = parseAsStringLiteral(VIEWS).withDefault("volume").withOptions(push);
export const tabParser = parseAsStringLiteral(TABS).withDefault("overview").withOptions(push);

const serializeRange = createSerializer(rangeParsers, { clearOnDefault: false });

export function presetParams(preset: Preset): RangeParams {
  return { range: preset, from: null, to: null };
}

export function customParams(from: string, to: string): RangeParams {
  return { range: DEFAULT_PRESET, from, to };
}

/** Builds an href that carries only the range state (page-local params are dropped). */
export function rangeHref(pathname: string, params: RangeParams): string {
  if (isCustom(params)) {
    return serializeRange(pathname, { from: params.from, to: params.to });
  }
  return serializeRange(pathname, { range: params.range });
}
