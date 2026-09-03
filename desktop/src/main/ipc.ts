/**
 * The only contract between the main process and the card.
 *
 * The renderer runs with `contextIsolation` on and `nodeIntegration` off, so it cannot read a
 * rollout file, a config or a token even if it wanted to — everything it knows arrives through
 * these channels. Keeping the names and payloads in one file that both sides import is what makes
 * that boundary reviewable: the list below IS the renderer's capabilities.
 */
import type { CardReport } from "@cli/commands/card";
import type { SummaryRangeKey } from "@codex-kaboo/shared/summary";
import type { CardSettings } from "./settings";

export const CHANNELS = {
  /** Renderer → main, on load: the current state, without waiting for the next push. */
  getState: "card:get-state",
  /** Main → renderer: a new state, pushed only when something actually changed. */
  state: "card:state",
  /** Renderer → main: refetch now (the refresh button). */
  refresh: "card:refresh",
  /** Renderer → main: run a full `codex-kaboo sync`, then refetch. */
  syncNow: "card:sync-now",
  /** Renderer → main: persist a settings change. */
  updateSettings: "card:update-settings",
  /** Renderer → main: open the dashboard in the default browser. */
  openDashboard: "card:open-dashboard",
  /** Renderer → main: hide the card (the close button, and Escape). */
  hide: "card:hide",
  /** Renderer → main: quit the app. */
  quit: "card:quit",
} as const;

/** What a sync triggered from the card is doing, so the button can say so. */
export type SyncStatus =
  | { state: "idle"; lastError: string | null }
  | { state: "running" }
  | { state: "blocked"; holder: string };

export interface CardState {
  /** Null only in the moment between the window opening and the first assembly finishing. */
  report: CardReport | null;
  settings: CardSettings;
  sync: SyncStatus;
  /** Whether a summary fetch is in flight, so the refresh button can spin. */
  refreshing: boolean;
  /** `webOrigin` from the build, or derived from the configured server; null when unknown. */
  dashboardUrl: string | null;
  appVersion: string;
}

export interface UpdateSettingsRequest {
  range?: SummaryRangeKey;
  height?: number;
  refreshMs?: number;
  windowMinutes?: number;
  launchAtLogin?: boolean;
  showTrayLabel?: boolean;
}

/** The surface `preload` exposes on `window.kaboo`. */
export interface CardBridge {
  getState(): Promise<CardState>;
  onState(listener: (state: CardState) => void): () => void;
  refresh(): Promise<void>;
  syncNow(): Promise<void>;
  updateSettings(patch: UpdateSettingsRequest): Promise<void>;
  openDashboard(): Promise<void>;
  hide(): Promise<void>;
  quit(): Promise<void>;
}
