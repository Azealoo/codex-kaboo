import { describe, expect, it } from "vitest";
import { OTHER_KEY } from "../../../shared/src/constants";
import { emptyTokens } from "../../../shared/src/metrics";
import type { Tokens } from "../../../shared/src/sync";
import { emptyAggregate, type Aggregate } from "./aggregate";
import { topModelOf } from "./periods";

function tokens(total: number): Tokens {
  return { ...emptyTokens(), input: total, total };
}

function withModels(entries: { key: string; effort?: string; total: number }[]): Aggregate {
  return {
    ...emptyAggregate(),
    byModel: entries.map((e) => ({
      key: e.key,
      ...(e.effort === undefined ? {} : { effort: e.effort }),
      tokens: tokens(e.total),
      responses: 1,
    })),
  };
}

describe("topModelOf", () => {
  it("is null when nothing was used", () => {
    expect(topModelOf(emptyAggregate())).toBeNull();
  });

  it("picks the model with the most tokens", () => {
    expect(
      topModelOf(
        withModels([
          { key: "a", total: 10 },
          { key: "b", total: 30 },
        ]),
      ),
    ).toBe("b");
  });

  it("folds a model's efforts together before ranking", () => {
    // `byModel` is keyed on (model, effort), so a model split across efforts must not lose to a
    // single-effort rival that only looks bigger row by row.
    const agg = withModels([
      { key: "split", effort: "low", total: 20 },
      { key: "split", effort: "high", total: 20 },
      { key: "single", total: 30 },
    ]);
    expect(topModelOf(agg)).toBe("split");
  });

  it("never reports the keyed-array fold as a model", () => {
    const agg = withModels([
      { key: OTHER_KEY, total: 900 },
      { key: "gpt-5.6-sol", total: 10 },
    ]);
    expect(topModelOf(agg)).toBe("gpt-5.6-sol");
    expect(topModelOf(withModels([{ key: OTHER_KEY, total: 900 }]))).toBeNull();
  });

  it("ignores models that recorded no tokens, and breaks ties by name", () => {
    expect(topModelOf(withModels([{ key: "a", total: 0 }]))).toBeNull();
    expect(
      topModelOf(
        withModels([
          { key: "b", total: 5 },
          { key: "a", total: 5 },
        ]),
      ),
    ).toBe("a");
  });
});
