/**
 * Where the card goes when the tray icon is clicked.
 *
 * Pure: rectangles in, a rectangle out. Anchoring is the part of a menu bar app that breaks most
 * often and is hardest to notice — a card half off the right edge of a second display, or under a
 * MacBook's notch — and none of those cases are reachable from a unit test if the geometry is
 * tangled up with Electron's `Tray` and `screen` objects. So it isn't.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 372 × 600, minimum 420 — the reference app's tuned geometry, and it holds up. */
export const CARD_WIDTH = 372;
export const CARD_DEFAULT_HEIGHT = 600;
export const CARD_MIN_HEIGHT = 420;

/** Gap between the tray icon and the card. */
export const TRAY_GAP = 6;
/** How close the card may come to the left or right edge of the work area. */
export const EDGE_MARGIN = 8;
/** Breathing room kept below the card when the work area is short. */
export const WORK_AREA_SLACK = 40;

export interface AnchorInput {
  /** The tray icon's screen bounds. All zeroes on desktops that will not report them. */
  tray: Rect;
  /** The work area of the display the icon is on — already excludes the menu bar or taskbar. */
  workArea: Rect;
  size: { width: number; height: number };
  /** Used when `tray` is empty; the pointer is the best guess left. */
  cursor?: Point;
  gap?: number;
  margin?: number;
}

function clamp(value: number, min: number, max: number): number {
  // `max < min` when the card is wider than the work area; the low edge wins, so at least the
  // card's leading corner is on screen rather than centred over nothing.
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/** True for the `{0,0,0,0}` some Linux desktops hand back instead of real tray bounds. */
export function isEmptyRect(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

/**
 * The height to open at: the user's preference, never below CARD_MIN_HEIGHT and never taller than
 * the work area minus a little slack. The slack matters on a laptop with a dock: without it the
 * card is exactly as tall as the usable screen and looks wedged in.
 */
export function clampCardHeight(preferred: number, workAreaHeight: number): number {
  const ceiling = Math.max(CARD_MIN_HEIGHT, workAreaHeight - WORK_AREA_SLACK);
  return Math.round(clamp(preferred, CARD_MIN_HEIGHT, ceiling));
}

/**
 * Centres the card on the tray icon and keeps it inside the work area.
 *
 * It opens BELOW the icon when the icon is in the top half of its display and above it otherwise,
 * rather than assuming a menu bar at the top: Windows puts the taskbar at the bottom by default,
 * and Linux panels go wherever the user put them.
 */
export function anchorRect(input: AnchorInput): Rect {
  const gap = input.gap ?? TRAY_GAP;
  const margin = input.margin ?? EDGE_MARGIN;
  const work = input.workArea;
  const { width, height } = input.size;

  // No usable tray bounds: anchor on the pointer, which is where the click that opened the card
  // came from. A zero-width rect at the cursor centres the card on it.
  const tray: Rect = isEmptyRect(input.tray)
    ? {
        x: input.cursor?.x ?? work.x + work.width / 2,
        y: input.cursor?.y ?? work.y,
        width: 0,
        height: 0,
      }
    : input.tray;

  const x = clamp(
    Math.round(tray.x + tray.width / 2 - width / 2),
    work.x + margin,
    work.x + work.width - width - margin,
  );

  const trayCentreY = tray.y + tray.height / 2;
  const below = trayCentreY < work.y + work.height / 2;
  const preferredY = below ? tray.y + tray.height + gap : tray.y - gap - height;
  // Clamped to the work area itself, with no extra margin: on macOS the work area already starts
  // below the menu bar (and below the notch, which the menu bar contains), so this is exactly the
  // line the card must not cross.
  const y = clamp(Math.round(preferredY), work.y, work.y + work.height - height);

  return { x, y, width, height };
}
