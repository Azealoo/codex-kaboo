/**
 * Launch at login.
 *
 * macOS and Windows have a first-class API for this (`app.setLoginItemSettings`), and using it
 * means the entry appears where the user expects to find it — System Settings › Login Items, or
 * the Startup tab of Task Manager — and disappears when the app is uninstalled.
 *
 * Linux has no such API, so this writes an XDG autostart entry. It reuses `assertNoNewline` from
 * the collector's scheduler for the same reason that function exists there: a newline in a path
 * silently truncates a generated unit file, and the result is an entry that looks installed and
 * does nothing.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { assertNoNewline } from "@cli/schedule/index";

const DESKTOP_ENTRY = "codex-kaboo-card.desktop";

function autostartDir(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME;
  const base =
    configHome !== undefined && configHome.trim().length > 0
      ? configHome.trim()
      : path.join(os.homedir(), ".config");
  return path.join(base, "autostart");
}

export function autostartFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(autostartDir(env), DESKTOP_ENTRY);
}

/**
 * The XDG entry, as text. Pure so it can be inspected in a test without writing anything —
 * the same shape as the collector's `renderPlist`.
 */
export function renderDesktopEntry(execPath: string): string {
  assertNoNewline(execPath, "executable path");
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=codex-kaboo",
    "Comment=Codex usage in your status bar",
    `Exec=${execPath}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  if (process.platform === "linux") {
    const file = autostartFile();
    if (!enabled) {
      await fs.rm(file, { force: true });
      return;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, renderDesktopEntry(process.execPath), "utf8");
    return;
  }
  // No `openAsHidden`: Electron dropped it, and it would be redundant anyway. The app has
  // `LSUIElement` set and opens no window at launch, so logging in puts it in the status bar
  // rather than in front of the user either way.
  app.setLoginItemSettings({ openAtLogin: enabled });
}

export async function getLaunchAtLogin(): Promise<boolean> {
  if (process.platform === "linux") {
    try {
      await fs.access(autostartFile());
      return true;
    } catch {
      return false;
    }
  }
  return app.getLoginItemSettings().openAtLogin;
}
