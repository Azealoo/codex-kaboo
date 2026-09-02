import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prices = [
  { _id: "p1", model: "model-a", inputUsdPerMTok: 1, cachedInputUsdPerMTok: 0.1, outputUsdPerMTok: 5, source: "manual", updatedAt: 1 },
  { _id: "p2", model: "model-b", inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 8, source: "manual", updatedAt: 2 },
];

// `upsert` is looked up once per row (`useMutation(api.prices.upsert)`), so every row shares this
// same mock function reference — exactly like the real Convex hook. What varies is the `model` in
// the call args: model-a always rejects, model-b always resolves.
const runMutation = vi.fn(async (args: { model: string; inputUsdPerMTok?: number }) => {
  if ("inputUsdPerMTok" in args) {
    if (args.model === "model-a") throw new Error("model-a save rejected");
    return "id-model-b";
  }
  return null;
});

const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({
  // PricesCard issues two distinct `useQuery` calls: `api.prices.list` with `{}`, and (via
  // `useStableQuery`) `api.stats.summary` with an object carrying `previous`. Only the price list
  // matters here, so the stats query is left "loading" (undefined) and the unpriced-models banner
  // simply doesn't render.
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => runMutation,
}));

import { PricesCard } from "./prices-card";

describe("PricesCard", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockImplementation((_query: unknown, args: unknown) =>
      args && typeof args === "object" && "previous" in args ? undefined : prices,
    );
    runMutation.mockClear();
  });

  it("keeps one row's save error visible after a different row's save succeeds", async () => {
    render(<PricesCard />);
    const rowA = screen.getByText("model-a").closest("tr");
    const rowB = screen.getByText("model-b").closest("tr");
    if (!rowA || !rowB) throw new Error("expected both price rows to render");

    await userEvent.click(within(rowA).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("model-a save rejected")).toBeInTheDocument();

    await userEvent.click(within(rowB).getByRole("button", { name: "Save" }));
    // model-b's save resolves — model-a's still-unfixed error must remain visible, not be wiped
    // out by the sibling row's success.
    expect(screen.getByText("model-a save rejected")).toBeInTheDocument();
  });
});
