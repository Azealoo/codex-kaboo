import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const options = [
  { value: "volume", label: "Volume" },
  { value: "efficiency", label: "Efficiency" },
];

describe("SegmentedControl", () => {
  it("calls onChange with the clicked value", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl ariaLabel="View" options={options} value="volume" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Efficiency" }));
    expect(onChange).toHaveBeenCalledWith("efficiency");
  });
  it("never empties: clicking the selected option keeps it selected", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl ariaLabel="View" options={options} value="volume" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Volume" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Volume" })).toHaveAttribute("aria-checked", "true");
  });
});
