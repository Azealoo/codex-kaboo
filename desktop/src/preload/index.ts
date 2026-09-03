/**
 * The bridge, and the whole of it.
 *
 * `contextBridge` is the only thing the card can reach outside its own page. Every method below is
 * a fixed channel with no caller-supplied target, so the renderer cannot ask the main process to
 * do anything that is not on this list — it cannot read a file, run a command, or reach the
 * network on its own.
 */
import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type CardBridge, type CardState, type UpdateSettingsRequest } from "../main/ipc";

const bridge: CardBridge = {
  getState: () => ipcRenderer.invoke(CHANNELS.getState) as Promise<CardState>,
  onState(listener) {
    const handler = (_event: unknown, state: CardState): void => listener(state);
    ipcRenderer.on(CHANNELS.state, handler);
    return () => ipcRenderer.removeListener(CHANNELS.state, handler);
  },
  refresh: () => ipcRenderer.invoke(CHANNELS.refresh) as Promise<void>,
  syncNow: () => ipcRenderer.invoke(CHANNELS.syncNow) as Promise<void>,
  updateSettings: (patch: UpdateSettingsRequest) =>
    ipcRenderer.invoke(CHANNELS.updateSettings, patch) as Promise<void>,
  openDashboard: () => ipcRenderer.invoke(CHANNELS.openDashboard) as Promise<void>,
  hide: () => ipcRenderer.invoke(CHANNELS.hide) as Promise<void>,
  quit: () => ipcRenderer.invoke(CHANNELS.quit) as Promise<void>,
};

contextBridge.exposeInMainWorld("kaboo", bridge);
