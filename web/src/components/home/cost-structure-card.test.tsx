import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CostByKind } from "@convex/lib/types";
import { CostStructureCard } from "./cost-structure-card";

const costByKind: CostByKind = { input: 10, cached: 5, output: 20, reasoning: 2 };

describe("CostStructureCard", () => {
  it("discloses unpriced models in the muted footer when there are any", () => {
    render(
      <CostStructureCard
        costByKind={costByKind}
        costUsd={37}
        cacheSavingsUsd={4}
        unpricedModels={["gpt-5.6-sol", "codex-auto-review"]}
      />,
    );
    expect(screen.getByText("Unpriced: gpt-5.6-sol, codex-auto-review")).toBeInTheDocument();
  });

  it("shows no unpriced disclosure when the list is empty", () => {
    render(
      <CostStructureCard
        costByKind={costByKind}
        costUsd={37}
        cacheSavingsUsd={4}
        unpricedModels={[]}
      />,
    );
    expect(screen.queryByText(/Unpriced/)).not.toBeInTheDocument();
  });
});
