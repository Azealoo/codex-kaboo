import { describe, expect, it } from "vitest";
import { TABS, type Tab } from "@/lib/search-params";

// TABS is the single source of truth for Tab; if they drift, this stops compiling.
const _tabsCoverTab: readonly Tab[] = TABS;
const _tabCoversTabs: Tab = TABS[0]!;

describe("TABS / Tab", () => {
  it("has exactly the four tabs TabBody's switch handles", () => {
    expect(TABS.length).toBe(4);
    const known: readonly string[] = ["overview", "breakdown", "efficiency", "sessions"];
    for (const tab of TABS) {
      expect(known).toContain(tab);
    }
    // Reference the compile-time-only checks above so they aren't dead code.
    expect(_tabsCoverTab).toBe(TABS);
    expect(_tabCoversTabs).toBe(TABS[0]);
  });
});
