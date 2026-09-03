import { describe, expect, it } from "vitest";
import {
  anchorRect,
  clampCardHeight,
  isEmptyRect,
  CARD_MIN_HEIGHT,
  CARD_WIDTH,
  type Rect,
} from "../src/main/anchor";

/** A 1440 × 900 laptop whose 25 px menu bar is already excluded from the work area. */
const LAPTOP: Rect = { x: 0, y: 25, width: 1440, height: 875 };
/** A second display to the right, with a taskbar at the bottom. */
const SECOND: Rect = { x: 1440, y: 0, width: 1920, height: 1040 };

const size = { width: CARD_WIDTH, height: 600 };

describe("anchorRect", () => {
  it("centres the card under a tray icon in the menu bar", () => {
    const tray: Rect = { x: 1200, y: 0, width: 24, height: 24 };
    const rect = anchorRect({ tray, workArea: LAPTOP, size });
    expect(rect.x).toBe(1200 + 12 - CARD_WIDTH / 2);
    expect(rect.y).toBe(24 + 6); // just below the icon
    expect(rect.width).toBe(CARD_WIDTH);
  });

  it("opens upwards from a taskbar at the bottom of the screen", () => {
    const tray: Rect = { x: 1800, y: 1010, width: 24, height: 24 };
    const rect = anchorRect({ tray, workArea: SECOND, size });
    expect(rect.y).toBe(1010 - 6 - 600);
    expect(rect.y + rect.height).toBeLessThan(tray.y);
  });

  it("keeps the card on screen at the right edge", () => {
    const tray: Rect = { x: 1430, y: 0, width: 10, height: 24 };
    const rect = anchorRect({ tray, workArea: LAPTOP, size });
    expect(rect.x + rect.width).toBe(LAPTOP.x + LAPTOP.width - 8);
  });

  it("keeps the card on screen at the left edge", () => {
    const tray: Rect = { x: 0, y: 0, width: 10, height: 24 };
    const rect = anchorRect({ tray, workArea: LAPTOP, size });
    expect(rect.x).toBe(LAPTOP.x + 8);
  });

  it("stays on the display the icon is on", () => {
    // Same icon position, two displays: the card follows the work area it is given, so a caller
    // using `screen.getDisplayMatching(trayBounds)` gets the right screen for free.
    const tray: Rect = { x: 3350, y: 0, width: 24, height: 24 };
    const rect = anchorRect({ tray, workArea: SECOND, size });
    expect(rect.x).toBeGreaterThanOrEqual(SECOND.x);
    expect(rect.x + rect.width).toBeLessThanOrEqual(SECOND.x + SECOND.width);
  });

  it("never crosses the top of the work area, which is where the notch lives", () => {
    // A tray icon reporting y = 0 (the physical top of a notched display); the work area starts
    // below the menu bar, and the card must start below that.
    const tray: Rect = { x: 700, y: 0, width: 24, height: 0 };
    const rect = anchorRect({ tray, workArea: LAPTOP, size });
    expect(rect.y).toBeGreaterThanOrEqual(LAPTOP.y);
  });

  it("falls back to the cursor when the desktop will not report tray bounds", () => {
    const rect = anchorRect({
      tray: { x: 0, y: 0, width: 0, height: 0 },
      workArea: SECOND,
      size,
      cursor: { x: 2000, y: 1030 },
    });
    expect(rect.x).toBe(2000 - CARD_WIDTH / 2);
    expect(rect.y).toBe(1030 - 6 - 600); // below the midpoint, so it opens upwards
  });

  it("centres horizontally when there are neither tray bounds nor a cursor", () => {
    const rect = anchorRect({
      tray: { x: 0, y: 0, width: 0, height: 0 },
      workArea: LAPTOP,
      size,
    });
    expect(rect.x).toBe(Math.round(LAPTOP.width / 2 - CARD_WIDTH / 2));
    expect(rect.y).toBeGreaterThanOrEqual(LAPTOP.y);
  });

  it("keeps a card taller than the screen anchored to the top of the work area", () => {
    const tray: Rect = { x: 700, y: 0, width: 24, height: 24 };
    const rect = anchorRect({ tray, workArea: { x: 0, y: 25, width: 1440, height: 400 }, size });
    expect(rect.y).toBe(25);
  });
});

describe("isEmptyRect", () => {
  it("recognises the zeroes some desktops hand back", () => {
    expect(isEmptyRect({ x: 0, y: 0, width: 0, height: 0 })).toBe(true);
    expect(isEmptyRect({ x: 10, y: 10, width: 0, height: 24 })).toBe(true);
    expect(isEmptyRect({ x: 10, y: 10, width: 24, height: 24 })).toBe(false);
  });
});

describe("clampCardHeight", () => {
  it("honours a preference that fits", () => {
    expect(clampCardHeight(600, 900)).toBe(600);
  });

  it("never goes below the minimum, however short the screen", () => {
    expect(clampCardHeight(100, 900)).toBe(CARD_MIN_HEIGHT);
    expect(clampCardHeight(600, 300)).toBe(CARD_MIN_HEIGHT);
  });

  it("leaves slack below the card on a short screen", () => {
    expect(clampCardHeight(900, 620)).toBe(580);
  });
});
