// Copies the MediaPipe WASM runtime from node_modules into public/ so the app
// serves it from its own origin (works offline, no CDN). Runs on npm install.
import { copyFile, mkdir } from 'node:fs/promises';

const src = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const dest = new URL('../public/mediapipe/', import.meta.url);
// The classic-worker builds: SIMD, plus the fallback for browsers without WASM SIMD.
const files = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

await mkdir(dest, { recursive: true });
for (const f of files) await copyFile(new URL(f, src), new URL(f, dest));
console.log(`Copied ${files.length} MediaPipe files to public/mediapipe/`);
