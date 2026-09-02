import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { withNuqsTestingAdapter, type OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("@/hooks/use-today", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-today")>()),
  useToday: () => "2026-09-15",
}));

import { RangePicker } from "./range-picker";

describe("RangePicker", () => {
  it("shows the current preset and pushes ?range=7D when a preset row is clicked", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    render(<RangePicker />, { wrapper: withNuqsTestingAdapter({ searchParams: "?range=30D", onUrlUpdate }) });
    const trigger = screen.getByRole("button", { name: /Change date range/ });
    expect(trigger).toHaveTextContent("Last 30 days");
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("option", { name: /Last 7 days/ }));
    expect(onUrlUpdate).toHaveBeenCalledOnce();
    const event = onUrlUpdate.mock.calls[0]![0]!;
    expect(event.queryString).toBe("?range=7D");
    expect(event.options.history).toBe("push");
  });

  it("writes from/to for a custom range and drops the preset", async () => {
    const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
    render(<RangePicker />, { wrapper: withNuqsTestingAdapter({ searchParams: "?range=30D", onUrlUpdate }) });
    await userEvent.click(screen.getByRole("button", { name: /Change date range/ }));
    await userEvent.click(screen.getByRole("button", { name: /September 3(rd)?, 2026/ }));
    await userEvent.click(screen.getByRole("button", { name: /September 10(th)?, 2026/ }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    const event = onUrlUpdate.mock.calls.at(-1)![0]!;
    expect(event.searchParams.get("from")).toBe("2026-09-03");
    expect(event.searchParams.get("to")).toBe("2026-09-10");
    expect(event.searchParams.get("range")).toBeNull();
  });
});
