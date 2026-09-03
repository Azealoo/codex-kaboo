/**
 * The app itself: one tray icon, one popover, one service, and nothing else.
 *
 * It is a background app in the strict sense — no dock icon, no taskbar entry, no window on
 * launch. Quitting is an explicit menu item, because closing the card is how you use it.
 */
import { app, ipcMain, shell, type Tray } from "electron";
import { formatCompact } from "@codex-kaboo/shared/format";
import { CHANNELS, type CardState, type UpdateSettingsRequest } from "./ipc";
import { createPopover, distPath, type Popover } from "./popover";
import { createService, type CardService } from "./service";
import { createTray, setTrayLabel } from "./tray";
import { getLaunchAtLogin, setLaunchAtLogin } from "./autostart";

let tray: Tray | null = null;
let popover: Popover | null = null;

/**
 * A second launch must not add a second icon to the menu bar. Electron hands the first instance
 * the event instead, which is the right behaviour: showing the card is exactly what someone who
 * launched the app again wanted.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => popover?.show(tray));
  void main();
}

function trayLabelFor(state: CardState): string {
  if (!state.settings.showTrayLabel) return "";
  const total = state.report?.ranges?.day.tokens.total;
  return total === undefined ? "" : formatCompact(total);
}

async function main(): Promise<void> {
  // No dock icon on macOS. `LSUIElement` in the packaged Info.plist does the same thing before the
  // app ever starts; this covers running unpackaged, where there is no plist to read.
  app.dock?.hide();
  await app.whenReady();

  const current = createService({ appVersion: app.getVersion() });
  // Settings before the window: its height is one of them, and a window built before they load
  // opens at the default size every launch, quietly throwing away the size the user chose.
  const settings = await current.loadSettings();

  popover = createPopover(distPath("preload", "index.js"), distPath("renderer", "index.html"), {
    height: settings.height,
    onResize: (height) => void current.updateSettings({ height }),
    onVisibilityChange: (visible) => current.setVisible(visible),
  });
  const panel = popover;

  tray = createTray({
    onToggle: () => panel.toggle(tray),
    onOpen: () => panel.show(tray),
    onSyncNow: () => void current.syncNow(),
    onOpenDashboard: () => void openDashboard(current),
    onQuit: () => app.quit(),
    dashboardUrl: current.state().dashboardUrl,
  });
  const icon = tray;

  current.subscribe((state) => {
    setTrayLabel(icon, trayLabelFor(state));
    // `isDestroyed` guards the window closing while a push is in flight during quit.
    if (!panel.window.isDestroyed()) panel.window.webContents.send(CHANNELS.state, state);
  });

  ipcMain.handle(CHANNELS.getState, () => current.state());
  ipcMain.handle(CHANNELS.refresh, () => current.refresh());
  ipcMain.handle(CHANNELS.syncNow, () => current.syncNow());
  ipcMain.handle(CHANNELS.openDashboard, () => openDashboard(current));
  ipcMain.handle(CHANNELS.hide, () => panel.hide());
  ipcMain.handle(CHANNELS.quit, () => app.quit());
  ipcMain.handle(CHANNELS.updateSettings, async (_event, patch: UpdateSettingsRequest) => {
    const settings = await current.updateSettings(patch);
    if (patch.height !== undefined) panel.setHeight(settings.height);
    if (patch.launchAtLogin !== undefined) await setLaunchAtLogin(settings.launchAtLogin);
  });

  await current.start();
  // The OS is the authority on whether the app launches at login, not our settings file: the user
  // can turn it off in System Settings and we would otherwise keep claiming it is on.
  const actual = await getLaunchAtLogin();
  if (actual !== current.state().settings.launchAtLogin) {
    await current.updateSettings({ launchAtLogin: actual });
  }

  // A menu bar app has no windows most of the time; without this Electron quits the moment the
  // popover is hidden on macOS.
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", () => {
    current.dispose();
    icon.destroy();
  });
}

async function openDashboard(current: CardService): Promise<void> {
  const url = current.state().dashboardUrl;
  if (url !== null) await shell.openExternal(url);
}
