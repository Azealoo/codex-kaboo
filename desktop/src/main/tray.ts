/**
 * The status-bar icon.
 *
 * Three platforms behave differently enough that pretending otherwise produces an app that quietly
 * does nothing on one of them:
 *
 *  - **macOS** — a black-on-transparent template image, so the system recolours it for light, dark
 *    and the highlighted menu bar. Left click toggles the card; right click opens the menu.
 *  - **Windows** — a coloured `.ico`, the label in the tooltip, same click behaviour.
 *  - **Linux** — a coloured 22 px PNG and a context menu attached permanently, because a left
 *    click on a tray icon is not delivered on every desktop environment. Setting the menu means
 *    the icon always does *something*. GNOME needs the AppIndicator extension for a tray at all;
 *    that is in the README rather than hidden here.
 */
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from "electron";
import { distPath } from "./popover";

export interface TrayHandlers {
  onToggle: () => void;
  onOpen: () => void;
  onSyncNow: () => void;
  onOpenDashboard: () => void;
  onQuit: () => void;
  /** Null hides the dashboard entry rather than offering a link to nowhere. */
  dashboardUrl: string | null;
}

function trayImage(): Electron.NativeImage {
  if (process.platform === "darwin") {
    const image = nativeImage.createFromPath(distPath("assets", "trayTemplate.png"));
    // Without this the icon is drawn as-is: solid black on a dark menu bar, invisible.
    image.setTemplateImage(true);
    return image;
  }
  if (process.platform === "win32") {
    return nativeImage.createFromPath(distPath("assets", "icon.ico"));
  }
  return nativeImage.createFromPath(distPath("assets", "tray-linux.png"));
}

export function createTray(handlers: TrayHandlers): Tray {
  const tray = new Tray(trayImage());
  tray.setToolTip("codex-kaboo");

  const template: MenuItemConstructorOptions[] = [
    { label: "Open codex-kaboo", click: handlers.onOpen },
    { label: "Sync now", click: handlers.onSyncNow },
    ...(handlers.dashboardUrl === null
      ? []
      : [{ label: "Open dashboard", click: handlers.onOpenDashboard }]),
    { type: "separator" as const },
    { label: "Quit", click: handlers.onQuit },
  ];
  const menu = Menu.buildFromTemplate(template);

  if (process.platform === "linux") {
    // Attaching the menu is what makes the icon usable where `click` never fires.
    tray.setContextMenu(menu);
  } else {
    tray.on("click", handlers.onToggle);
    tray.on("right-click", () => tray.popUpContextMenu(menu));
  }
  return tray;
}

/**
 * The compact label beside the icon (macOS only — Windows and Linux have nowhere to put it).
 * Empty string clears it, which is also what "off" means.
 */
export function setTrayLabel(tray: Tray, label: string): void {
  if (process.platform !== "darwin") return;
  tray.setTitle(label);
}
