import { useEffect, useMemo, useState } from "react";
import type { CardState } from "../main/ipc";
import { Card, type CardActions } from "./components/Card";

/**
 * `now` drives the relative labels ("Synced 4 min ago", "Resets in 5d"). It ticks on its own once a
 * second so those stay honest while the card sits open and no new state arrives — the state pushes
 * are digest-gated, so an idle card gets none.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** State, effects and the bridge. Everything visible lives in `Card`, which is pure. */
export function App(): React.ReactElement {
  const [state, setState] = useState<CardState | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const now = useNow();

  useEffect(() => {
    void window.kaboo.getState().then(setState);
    return window.kaboo.onState(setState);
  }, []);

  // Escape closes the card, the way every other status-bar panel behaves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (showSettings) setShowSettings(false);
      else void window.kaboo.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings]);

  const actions = useMemo<CardActions>(
    () => ({
      refresh: () => void window.kaboo.refresh(),
      syncNow: () => void window.kaboo.syncNow(),
      update: (patch) => void window.kaboo.updateSettings(patch),
      openDashboard: () => void window.kaboo.openDashboard(),
      quit: () => void window.kaboo.quit(),
      toggleSettings: () => setShowSettings((open) => !open),
    }),
    [],
  );

  if (state === null) return <div className="card" />;
  return <Card state={state} now={now} showSettings={showSettings} actions={actions} />;
}
