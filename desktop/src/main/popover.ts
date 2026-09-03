/**
 * The window the card lives in: a frameless, always-on-top panel that drops out of the tray icon
 * and hides as soon as you look away.
 */
import path from "node:path";
import { BrowserWindow, screen, shell, type Rectangle, type Tray } from "electron";
import { anchorRect, clampCardHeight, CARD_WIDTH, CARD_MIN_HEIGHT } from "./anchor";

export interface PopoverOptions {
  /** Height to open at, from settings; clamped to the display the card lands on. */
  height: number;
  /** Called when the user resizes, so the new height can be remembered. */
  onResize?: (height: number) => void;
  /** Called on hide, so the live sampler's timer can stop. */
  onVisibilityChange?: (visible: boolean) => void;
}

export interface Popover {
  window: BrowserWindow;
  show(tray: Tray | null): void;
  hide(): void;
  toggle(tray: Tray | null): void;
  isVisible(): boolean;
  setHeight(height: number): void;
  destroy(): void;
}

/**
 * How long after a hide a tray click is still treated as "the click that closed it".
 *
 * Clicking the icon while the card is open fires `blur` (which hides) and then the tray's `click`
 * (which would show it again), and the card blinks instead of closing. The reference app's own
 * acceptance script calls this out as the toggle race; 250 ms is comfortably longer than the gap
 * between those two events and far shorter than a deliberate second click.
 */
const REOPEN_GUARD_MS = 250;

export function createPopover(
  preloadPath: string,
  pagePath: string,
  opts: PopoverOptions,
): Popover {
  let lastHiddenAt = 0;
  let currentHeight = opts.height;

  const window = new BrowserWindow({
    width: CARD_WIDTH,
    height: currentHeight,
    minWidth: CARD_WIDTH,
    maxWidth: CARD_WIDTH, // the layout is designed for one width; let the user change only height
    minHeight: CARD_MIN_HEIGHT,
    show: false,
    frame: false,
    resizable: true,
    movable: false, // it belongs to the tray icon; a dragged panel would just be lost
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // A panel follows the active space instead of yanking the user back to the one it was opened
    // on; on Windows and Linux this is ignored.
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    webPreferences: {
      preload: preloadPath,
      // The renderer gets no Node and no direct access to anything: everything it can do is the
      // list in `ipc.ts`. It reads local usage data, so this is not a formality.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !process.env.CODEX_KABOO_CARD_NO_DEVTOOLS,
    },
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  void window.loadFile(pagePath);

  // Links leave for the real browser; nothing navigates inside the card. Without this a stray
  // anchor would replace the card with a web page and there would be no way back.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  window.on("blur", () => {
    if (window.isVisible()) hide();
  });

  window.on("resize", () => {
    if (!window.isVisible()) return;
    currentHeight = window.getBounds().height;
    opts.onResize?.(currentHeight);
  });

  function hide(): void {
    if (!window.isVisible()) return;
    lastHiddenAt = Date.now();
    window.hide();
    opts.onVisibilityChange?.(false);
  }

  function show(tray: Tray | null): void {
    const trayBounds: Rectangle = tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
    const cursor = screen.getCursorScreenPoint();
    // `getDisplayMatching` on the icon's own bounds is what puts the card on the display the icon
    // is actually on; on a desktop that reports no bounds, the pointer is the next best anchor.
    const display =
      trayBounds.width > 0
        ? screen.getDisplayMatching(trayBounds)
        : screen.getDisplayNearestPoint(cursor);
    const height = clampCardHeight(currentHeight, display.workArea.height);
    const rect = anchorRect({
      tray: trayBounds,
      workArea: display.workArea,
      size: { width: CARD_WIDTH, height },
      cursor,
    });
    window.setBounds(rect);
    window.show();
    window.focus();
    opts.onVisibilityChange?.(true);
  }

  return {
    window,
    show,
    hide,
    toggle(tray) {
      if (window.isVisible()) {
        hide();
        return;
      }
      // The click that dismissed the card must not immediately reopen it — see REOPEN_GUARD_MS.
      if (Date.now() - lastHiddenAt < REOPEN_GUARD_MS) return;
      show(tray);
    },
    isVisible: () => window.isVisible(),
    setHeight(height) {
      currentHeight = height;
    },
    destroy() {
      window.destroy();
    },
  };
}

/** Resolves a file next to the built main bundle (`dist/main/…`). */
export function distPath(...segments: string[]): string {
  return path.join(__dirname, "..", ...segments);
}
