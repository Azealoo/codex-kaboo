import { promises as fs } from "node:fs";
import path from "node:path";
import type { Config } from "../types";
import type { KabooPaths } from "./paths";

/** Writes `<file>.<pid>.tmp` then renames it over `file`; creates the directory (0700) on demand. */
export async function writeJsonAtomic(file: string, value: unknown, mode?: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: mode ?? 0o644,
  });
  if (mode !== undefined) {
    try {
      await fs.chmod(tmp, mode);
    } catch {
      // Windows has no POSIX modes
    }
  }
  await fs.rename(tmp, file);
}

export async function readConfig(paths: KabooPaths): Promise<Config | null> {
  let text: string;
  try {
    text = await fs.readFile(paths.config, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let raw: Partial<Config>;
  try {
    raw = JSON.parse(text) as Partial<Config>;
  } catch {
    throw new Error(`${paths.config} is not valid JSON; run \`codex-kaboo login\` again`);
  }
  if (
    typeof raw.server !== "string" ||
    typeof raw.token !== "string" ||
    typeof raw.machineId !== "string"
  ) {
    return null;
  }
  return {
    server: raw.server,
    token: raw.token,
    machineId: raw.machineId,
    label: typeof raw.label === "string" && raw.label.length > 0 ? raw.label : "unnamed-machine",
    hostnameOptIn: raw.hostnameOptIn === true,
    codexHomes: Array.isArray(raw.codexHomes)
      ? raw.codexHomes.filter((x): x is string => typeof x === "string")
      : [],
    ...(raw.userId !== undefined ? { userId: raw.userId } : {}),
    ...(raw.userName !== undefined ? { userName: raw.userName } : {}),
    ...(raw.userEmail !== undefined ? { userEmail: raw.userEmail } : {}),
    ...(raw.tokenName !== undefined ? { tokenName: raw.tokenName } : {}),
    ...(raw.loggedInAt !== undefined ? { loggedInAt: raw.loggedInAt } : {}),
  };
}

export async function writeConfig(paths: KabooPaths, config: Config): Promise<void> {
  await writeJsonAtomic(paths.config, config, 0o600);
}

/** Returns false when there was nothing to delete. */
export async function deleteConfig(paths: KabooPaths): Promise<boolean> {
  try {
    await fs.rm(paths.config);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
