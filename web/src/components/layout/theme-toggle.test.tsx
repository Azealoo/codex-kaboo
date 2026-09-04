import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { ThemeProvider } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

function mockMatchMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mq));
  return {
    set(next: boolean) {
      mq.matches = next;
      listeners.forEach((l) => l());
    },
  };
}

describe("ThemeToggle + ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
  });

  it("follows the OS by default and writes the chosen preference to storage", async () => {
    const media = mockMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /Change theme/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    // An explicit choice ignores the OS flipping.
    act(() => media.set(false));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the stored key when going back to System and then tracks the OS", async () => {
    const media = mockMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Change theme/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "System" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    act(() => media.set(true));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
