import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

describe("dom test environment", () => {
  it("renders React with jest-dom matchers", () => {
    render(<p>hello codex-kaboo</p>);
    expect(screen.getByText("hello codex-kaboo")).toBeInTheDocument();
  });
});
