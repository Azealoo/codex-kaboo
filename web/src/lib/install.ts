export type InstallOs = "macos" | "linux" | "windows";
export const INSTALL_OS: { id: InstallOs; label: string }[] = [
  { id: "macos", label: "macOS" },
  { id: "linux", label: "Linux" },
  { id: "windows", label: "Windows" },
];

export const TESTED_CODEX_VERSION = "0.150.1";

export function tgzUrl(origin: string): string {
  return `${origin}/cli/codex-kaboo-cli.tgz`;
}

export function installCommands(origin: string, token?: string) {
  const url = tgzUrl(origin);
  return {
    // npm >= 12 refuses a remote tarball install without --allow-remote=all. A user copies
    // whichever card is in front of them on first run (onboarding, Data Sync, or Settings), so
    // there is no safe "plain" variant to offer alongside this one — always include the flag.
    install: `npm install -g --allow-remote=all ${url}`,
    login: `codex-kaboo login --token ${token ?? "<token>"}`,
    schedule: "codex-kaboo install",
    status: "codex-kaboo status",
  };
}

export type InstallStep = { title: string; command: string; note?: string };

const INSTALL_NOTES: Record<InstallOs, string> = {
  macos: "Needs Node 18+ (22+ recommended).",
  linux:
    "Needs Node 18+. If you get EACCES with a system Node, use nvm/fnm or `npm config set prefix ~/.npm-global` and add it to PATH.",
  windows:
    "Needs Node 18+. Make sure %AppData%\\npm is on PATH and, in PowerShell, that the execution policy allows npm scripts (`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).",
};

const SCHEDULE_NOTES: Record<InstallOs, string> = {
  macos: "Registers a launchd agent (com.codex-kaboo.sync) that syncs every 15 minutes and runs one sync now.",
  linux: "Adds a crontab block that syncs every 15 minutes (use `codex-kaboo install --systemd` for a user timer instead) and runs one sync now.",
  windows: "Creates the scheduled task codex-kaboo-sync (every 15 minutes, hidden window) and runs one sync now.",
};

export function installSteps(os: InstallOs, origin: string, token?: string): InstallStep[] {
  const c = installCommands(origin, token);
  return [
    { title: "Install the collector", command: c.install, note: INSTALL_NOTES[os] },
    { title: "Log in with your sync token", command: c.login, note: "Create a token on the Settings page. Only metadata is uploaded, never prompts, commands or file paths." },
    { title: "Schedule background sync", command: c.schedule, note: SCHEDULE_NOTES[os] },
    { title: "Check the status", command: c.status, note: "Shows the resolved Codex home, the last sync result and whether the schedule is healthy." },
  ];
}

function parseVersion(v: string): number[] | null {
  const core = v.trim().split("-")[0] ?? "";
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split(".").map(Number);
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a) ?? [];
  const pb = parseVersion(b) ?? [];
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function isNewerThanTested(version: string | null): boolean {
  if (version === null || parseVersion(version) === null) return false;
  return compareVersions(version, TESTED_CODEX_VERSION) === 1;
}
