/// <reference lib="webworker" />
import { FilesetResolver, InteractiveSegmenter, ObjectDetector } from '@mediapipe/tasks-vision';
import { buildLayers, refineAlpha } from './compose';
import { confidenceToAlpha, maskArea, resizeMask, type NormPoint, type Size } from './mask';
import type { EditMode, PrepareRequest, PrepareResponse, PrepareTimings } from './protocol';
import { subjectFromMask, suggestSubjects, type Detection } from './subject';

declare const self: DedicatedWorkerGlobalScope;

// Asset URLs are relative to the app's base so they work under /depth-photo-pwa/ too.
const BASE = new URL(import.meta.env.BASE_URL, self.location.origin).href;
const WASM_DIR = `${BASE}mediapipe`;
const DETECTOR_URL = `${BASE}models/efficientdet_lite0.tflite`;
const MAGIC_TOUCH_URL = `${BASE}models/magic_touch.tflite`;

let detector: ObjectDetector | null = null;
let picker: InteractiveSegmenter | null = null;
let ready: Promise<void> | null = null;

interface PhotoState {
  image: ImageBitmap;
  rgba: Uint8ClampedArray;
  size: Size;
  /** Merged subject confidence at image size. */
  conf: Float32Array;
  /** Points the selection was built from (auto suggestions and Add taps). */
  seeds: NormPoint[];
  history: { conf: Float32Array; seeds: NormPoint[] }[];
}

let photo: PhotoState | null = null;
const MAX_UNDO = 10;

function post(msg: PrepareResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

async function init(): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
  // CPU for both: in the owner's spike the detector returned the same wrong box
  // for every photo on the GPU delegate, and MagicTouch was faster on CPU.
  detector = await ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: DETECTOR_URL, delegate: 'CPU' },
    runningMode: 'IMAGE',
    scoreThreshold: 0.25,
    maxResults: 6,
  });
  picker = await InteractiveSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MAGIC_TOUCH_URL, delegate: 'CPU' },
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
}

function timed<T>(timings: PrepareTimings, step: string, fn: () => T): T {
  const t0 = performance.now();
  const out = fn();
  timings[step] = (timings[step] ?? 0) + Math.round(performance.now() - t0);
  return out;
}

/** One MagicTouch pass at a point; returns confidence at image size. */
function segmentAt(p: PhotoState, point: NormPoint): Float32Array {
  const r = picker!.segment(p.image, { keypoint: point });
  try {
    const masks = r.confidenceMasks ?? [];
    if (masks.length === 0) return new Float32Array(p.size.width * p.size.height);
    // Pick whichever output is "on" at the tapped point (as in the spike).
    let best = masks[0]!;
    let bestV = -1;
    for (const m of masks) {
      const d = m.getAsFloat32Array();
      const x = Math.min(m.width - 1, Math.floor(point.x * m.width));
      const y = Math.min(m.height - 1, Math.floor(point.y * m.height));
      const v = d[y * m.width + x]!;
      if (v > bestV) (bestV = v), (best = m);
    }
    return resizeMask(best.getAsFloat32Array(), { width: best.width, height: best.height }, p.size);
  } finally {
    r.close();
  }
}

function detect(p: PhotoState): Detection[] {
  const { detections } = detector!.detect(p.image);
  return detections
    .filter((d) => d.boundingBox)
    .map((d) => {
      const b = d.boundingBox!;
      const c = d.categories[0];
      return { label: c?.categoryName ?? '', score: c?.score ?? 0, x: b.originX, y: b.originY, width: b.width, height: b.height };
    });
}

function send(id: number, method: 'detector' | 'centre' | 'edit' | 'none', subjects: string[], timings: PrepareTimings): void {
  const p = photo!;
  let foreground: Uint8ClampedArray | null = null;
  let background: Uint8ClampedArray;
  if (maskArea(p.conf) > 0) {
    post({ type: 'progress', id, step: 'Filling in the background' });
    const alpha = timed(timings, 'edges', () => refineAlpha(p.conf, p.size, p.seeds));
    const layers = timed(timings, 'layers', () => buildLayers(p.rgba, p.size, alpha));
    foreground = layers.foreground;
    background = layers.background;
  } else {
    background = new Uint8ClampedArray(p.rgba);
  }
  const transfer: Transferable[] = [background.buffer as ArrayBuffer];
  if (foreground) transfer.push(foreground.buffer as ArrayBuffer);
  post(
    {
      type: 'result',
      id,
      width: p.size.width,
      height: p.size.height,
      foreground,
      background,
      subjects,
      method,
      canUndo: p.history.length > 0,
      timings,
    },
    transfer,
  );
}

async function processImage(id: number, image: ImageBitmap): Promise<void> {
  const timings: PrepareTimings = {};
  const size = { width: image.width, height: image.height };

  post({ type: 'progress', id, step: 'Loading the cut-out models' });
  const t0 = performance.now();
  ready ??= init().catch((err) => {
    ready = null;
    throw err;
  });
  await ready;
  timings.init = Math.round(performance.now() - t0);

  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable in worker');
  ctx.drawImage(image, 0, 0);
  photo?.image.close();
  photo = {
    image,
    rgba: ctx.getImageData(0, 0, size.width, size.height).data,
    size,
    conf: new Float32Array(size.width * size.height),
    seeds: [],
    history: [],
  };
  const p = photo;

  post({ type: 'progress', id, step: 'Finding the subject' });
  const suggestions = timed(timings, 'detect', () => suggestSubjects(detect(p), size));

  post({ type: 'progress', id, step: 'Cutting out the subject' });
  let method: 'detector' | 'centre' | 'none' = 'detector';
  if (suggestions.length > 0) {
    for (const s of suggestions) {
      const m = timed(timings, 'cut', () => segmentAt(p, s.point));
      for (let i = 0; i < m.length; i++) if (m[i]! > p.conf[i]!) p.conf[i] = m[i]!;
      p.seeds.push(s.point);
    }
  } else {
    // Nothing the detector knows: try MagicTouch on the centre and keep it if it looks like one object.
    const centre = { x: 0.5, y: 0.5 };
    const m = timed(timings, 'cut', () => segmentAt(p, centre));
    const s = subjectFromMask(m, size);
    if (s) {
      p.conf = m;
      p.seeds.push(s.point);
      method = 'centre';
    } else {
      method = 'none';
    }
  }
  send(id, method, suggestions.map((s) => s.label), timings);
}

function edit(id: number, mode: EditMode, point: NormPoint): void {
  const p = photo;
  if (!p || !picker) throw new Error('No photo loaded');
  const timings: PrepareTimings = {};
  post({ type: 'progress', id, step: mode === 'add' ? 'Adding' : 'Removing' });
  const m = timed(timings, 'cut', () => segmentAt(p, point));
  p.history.push({ conf: p.conf, seeds: p.seeds });
  if (p.history.length > MAX_UNDO) p.history.shift();
  const next = new Float32Array(p.conf);
  if (mode === 'add') {
    for (let i = 0; i < m.length; i++) if (m[i]! > next[i]!) next[i] = m[i]!;
    p.seeds = [...p.seeds, point];
  } else {
    const cut = confidenceToAlpha(m);
    for (let i = 0; i < m.length; i++) next[i] = next[i]! * (1 - cut[i]!);
  }
  p.conf = next;
  send(id, 'edit', [], timings);
}

function undo(id: number): void {
  const p = photo;
  if (!p) throw new Error('No photo loaded');
  const prev = p.history.pop();
  if (prev) {
    p.conf = prev.conf;
    p.seeds = prev.seeds;
  }
  send(id, 'edit', [], {});
}

self.onmessage = async (e: MessageEvent<PrepareRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'process') await processImage(msg.id, msg.image);
    else if (msg.type === 'edit') edit(msg.id, msg.mode, msg.point);
    else undo(msg.id);
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
