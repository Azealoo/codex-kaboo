/**
 * Copies the runtime images into `dist/`.
 *
 * They have to end up beside the built main process, because that is the only directory the app
 * can address the same way unpackaged and inside an asar — `dist/**` is what electron-builder
 * packages, and `__dirname` points into it either way. `build/` is electron-builder's own config
 * directory (where it looks for `icon.icns` and friends) and is deliberately NOT shipped.
 */
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../assets", import.meta.url));
const to = fileURLToPath(new URL("../dist/assets", import.meta.url));

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
console.log(`copied assets -> ${to}`);
