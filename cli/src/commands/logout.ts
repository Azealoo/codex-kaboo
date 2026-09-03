import { clearSnapshotCache } from "../card/snapshot";
import { deleteConfig } from "../core/config";
import type { KabooPaths } from "../core/paths";
import type { Logger } from "../util/log";

/**
 * Removes config.json (token, server, machine id). state.json is kept so a re-login resumes where
 * it left off.
 *
 * The menu bar card's snapshot cache goes too. It is identity-fenced, so a stale one would be
 * rejected anyway, but leaving a file of one account's totals on disk after that account has been
 * logged out is not something to rely on a downstream check to hide.
 */
export async function runLogout(deps: {
  paths: KabooPaths;
  log: Logger;
}): Promise<{ ok: true; exitCode: 0; removed: boolean }> {
  const removed = await deleteConfig(deps.paths);
  await clearSnapshotCache(deps.paths);
  deps.log.info(
    removed
      ? "logged out: config.json removed (run `codex-kaboo uninstall` to stop the schedule)"
      : "not logged in",
  );
  return { ok: true, exitCode: 0, removed };
}
