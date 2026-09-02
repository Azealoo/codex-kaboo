import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RankMovement } from "./rank-movement";

describe("RankMovement", () => {
  it("renders 'new' when there is no previous rank", () => {
    render(<RankMovement rank={1} previousRank={null} />);
    expect(screen.getByText("new")).toBeInTheDocument();
  });
  it("renders the neutral state with neither the up nor the down colour class when rank is unchanged", () => {
    render(<RankMovement rank={2} previousRank={2} />);
    const el = screen.getByLabelText("No rank change");
    expect(el).toBeInTheDocument();
    expect(el).not.toHaveClass("text-delta-up-fg");
    expect(el).not.toHaveClass("text-delta-down-fg");
  });
  it("labels an improvement 'Up N places'", () => {
    render(<RankMovement rank={1} previousRank={3} />);
    expect(screen.getByLabelText("Up 2 places")).toBeInTheDocument();
  });
  it("labels a regression 'Down N places'", () => {
    render(<RankMovement rank={3} previousRank={1} />);
    expect(screen.getByLabelText("Down 2 places")).toBeInTheDocument();
  });
});
