import type { CardBridge } from "../main/ipc";

declare global {
  interface Window {
    /** Everything the card can do, exposed by `src/preload/index.ts`. */
    kaboo: CardBridge;
  }
}

export {};
