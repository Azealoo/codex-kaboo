import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatUsd } from "@shared/format";
import { StackedShareBar } from "./stacked-share-bar";

describe("StackedShareBar", () => {
  it("renders one segment per non-zero item with its share width and a legend row", () => {
    render(
      <StackedShareBar
        format={formatUsd}
        segments={[
          { key: "input", label: "Input", value: 7.5, share: 0.75, color: "#2a78d6" },
          { key: "output", label: "Output", value: 2.5, share: 0.25, color: "#eb6834" },
          { key: "reasoning", label: "Reasoning", value: 0, share: 0, color: "#4a3aa7" },
        ]}
      />,
    );
    const segments = screen.getAllByTestId("share-segment");
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveStyle({ width: "75%" });
    expect(screen.getByLabelText("Input: $7.50 (75.0%)")).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});
