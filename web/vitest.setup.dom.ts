import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// This project does not set `test.globals: true`, so @testing-library/react's own
// auto-cleanup (which only registers when it finds a *global* `afterEach`) never fires.
// Without this, DOM from one test's render() leaks into the next test in the same file.
afterEach(() => {
  cleanup();
});
