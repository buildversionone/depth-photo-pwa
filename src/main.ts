import './app/style.css';
import { registerSW } from 'virtual:pwa-register';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from './app/settings';
import { MotionController } from './motion/controller';
import { requestSensorPermission, SensorInput, sensorApisPresent, sensorsNeedPermission, type SensorSource } from './motion/sensors';
import { Canvas2DCompositor } from './render/canvas2d';
import type { Compositor } from './render/compositor';
import { canvasToImage, unitToPixelOffset } from './render/layout';
import { WebGLCompositor } from './render/webgl';
import { Preparer, type PrepareOutcome } from './prepare/client';
import type { EditMode } from './prepare/protocol';
import { createSampleScene } from './scene/sample';
import { DecodeError, decodeForProcessing } from './shared/decode';
import type { PixelOffset, PreparedScene } from './shared/types';

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const canvas = $<HTMLCanvasElement>('view');
const hud = $('hud');
const statusEl = $('status');
const btnEnable = $<HTMLButtonElement>('enable-motion');
const btnMotion = $<HTMLButtonElement>('toggle-motion');
const btnReset = $<HTMLButtonElement>('reset');
const btnSettings = $<HTMLButtonElement>('toggle-settings');
const form = $<HTMLFormElement>('settings');
const btnPick = $<HTMLButtonElement>('pick-photo');
const fileInput = $<HTMLInputElement>('photo-input');
const btnFix = $<HTMLButtonElement>('fix-cutout');
const toolbar = $('toolbar');
const editBar = $('edit-bar');
const btnAdd = $<HTMLButtonElement>('edit-add');
const btnRemove = $<HTMLButtonElement>('edit-remove');
const btnUndo = $<HTMLButtonElement>('edit-undo');
const btnDone = $<HTMLButtonElement>('edit-done');
const busy = $('busy');
const busyText = $('busy-text');

let settings: Settings = loadSettings();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---- Renderer -------------------------------------------------------------

function createCompositor(): Compositor {
  try {
    return new WebGLCompositor(canvas, (lost) => {
      setStatus(lost ? 'Graphics were reset by the browser. Restoring…' : '');
      dirty = true;
      requestFrame();
    });
  } catch (err) {
    console.warn('WebGL2 unavailable, using Canvas 2D', err);
    return new Canvas2DCompositor(canvas);
  }
}

const compositor = createCompositor();
let scene: PreparedScene = createSampleScene(settings.maxOffset);
/** Whether the current scene has a separated subject (otherwise it is shown still). */
let sceneHasSubject = true;
let lastTimings = '';
compositor.resize();
try {
  compositor.setScene(scene);
} catch (err) {
  setStatus(err instanceof Error ? err.message : String(err));
}

function showScene(next: PreparedScene, hasSubject: boolean): void {
  compositor.setScene(next);
  const prev = scene;
  scene = next;
  sceneHasSubject = hasSubject;
  scene.maxOffset = hasSubject ? settings.maxOffset : 0;
  // Release the previous layers' pixel memory promptly.
  for (const layer of [prev.background, prev.foreground]) {
    if (layer instanceof HTMLCanvasElement) layer.width = layer.height = 0;
  }
  manualHold = { x: 0, y: 0 };
  controller.setManual(null);
  controller.recenter();
  dirty = true;
  requestFrame();
}

// ---- Motion ---------------------------------------------------------------

const controller = new MotionController(settings);
let motionOn = settings.motionEnabled && !reducedMotion.matches;
let lastSource: SensorSource = 'none';
let lastSampleAt = -Infinity;
let permissionGranted = !sensorsNeedPermission();

const sensors = new SensorInput((s) => {
  if (s.source !== lastSource) {
    // Switching sources changes the reference frame; start from the current pose.
    controller.recenter();
    lastSource = s.source;
  }
  lastSampleAt = performance.now();
  if (!controller.hasManual) controller.addSample(s.tilt, s.tSec);
  requestFrame();
});

let noSensorTimer: number | undefined;

function startSensors(): void {
  if (!motionOn || !permissionGranted || document.hidden) return;
  sensors.start();
  window.clearTimeout(noSensorTimer);
  noSensorTimer = window.setTimeout(() => {
    if (sensors.isRunning && performance.now() - lastSampleAt > 1500) {
      setStatus('No tilt sensor found. Drag the photo to look around.');
    }
  }, 2000);
}

function stopSensors(): void {
  sensors.stop();
  lastSource = 'none';
  window.clearTimeout(noSensorTimer);
}

function sensorsLive(): boolean {
  return sensors.isRunning && performance.now() - lastSampleAt < 500;
}

// ---- Frame loop: draws only when the offset actually changes ---------------

let rafId = 0;
let dirty = true;
let lastDrawn: PixelOffset = { x: NaN, y: NaN };
let current: PixelOffset = { x: 0, y: 0 };
let draws = 0;
let drawRate = 0;
let drawWindowStart = performance.now();

function requestFrame(): void {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function frame(t: number): void {
  rafId = 0;
  const unit = controller.step(t / 1000);
  current = unitToPixelOffset(unit, scene.width, scene.height, scene.maxOffset);
  if (dirty || Math.abs(current.x - lastDrawn.x) > 0.01 || Math.abs(current.y - lastDrawn.y) > 0.01) {
    compositor.draw(current);
    lastDrawn = current;
    dirty = false;
    draws++;
  }
  if (t - drawWindowStart >= 1000) {
    drawRate = (draws * 1000) / (t - drawWindowStart);
    draws = 0;
    drawWindowStart = t;
  }
  if (settings.showHud) renderHud();
  if (!controller.isSettled() || sensorsLive() || settings.showHud) requestFrame();
}

const DEG = 180 / Math.PI;

function renderHud(): void {
  const raw = sensors.lastRaw;
  const maxTex = compositor instanceof WebGLCompositor ? compositor.maxTextureSize : 'n/a';
  hud.textContent = [
    `renderer  ${compositor.kind} (max texture ${maxTex})`,
    `sensor    ${sensors.isRunning ? sensors.source : 'off'}  ${sensors.rateHz.toFixed(0)} Hz`,
    `tilt      roll ${raw ? (raw.roll * DEG).toFixed(1) : '–'}°  pitch ${raw ? (raw.pitch * DEG).toFixed(1) : '–'}°`,
    `offset    ${current.x.toFixed(1)}, ${current.y.toFixed(1)} px (max ${(scene.maxOffset * Math.min(scene.width, scene.height)).toFixed(0)})`,
    `draws/s   ${drawRate.toFixed(0)}`,
    `canvas    ${canvas.width}×${canvas.height}  dpr ${devicePixelRatio}`,
    `image     ${scene.width}×${scene.height}  ${scene.label}`,
    ...(lastTimings ? [`timings   ${lastTimings}`] : []),
  ].join('\n');
}

// ---- Drag fallback ----------------------------------------------------------

let drag: { id: number; x: number; y: number; ox: number; oy: number } | null = null;
let manualHold: { x: number; y: number } = { x: 0, y: 0 };

/** Fix-cutout mode: taps add or remove whatever MagicTouch finds under them. */
let editing = false;
let editOp: EditMode = 'add';
let downAt: { x: number; y: number } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  if (editing) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: manualHold.x, oy: manualHold.y };
});

canvas.addEventListener('click', (e) => {
  if (!editing || processing || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 10) return;
  const rect = canvas.getBoundingClientRect();
  const p = canvasToImage(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height, scene.width, scene.height, scene.maxOffset);
  if (!p) return;
  void runPrepare(() => preparer.edit(editOp, p, (step) => setBusy(step)));
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  // A drag across a quarter of the view reaches the limit.
  const k = 4 / Math.max(1, Math.min(canvas.clientWidth, canvas.clientHeight));
  manualHold = {
    x: Math.max(-1, Math.min(1, drag.ox + (e.clientX - drag.x) * k)),
    y: Math.max(-1, Math.min(1, drag.oy + (e.clientY - drag.y) * k)),
  };
  controller.setManual(manualHold);
  requestFrame();
});

function endDrag(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  if (sensorsLive()) {
    // Hand control back to the sensors.
    manualHold = { x: 0, y: 0 };
    controller.setManual(null);
    controller.recenter();
  }
  requestFrame();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---- Controls -------------------------------------------------------------

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

function defaultStatus(): void {
  if (!motionOn && reducedMotion.matches) setStatus('Motion is off because your device prefers reduced motion. You can still drag the photo.');
  else if (!motionOn) setStatus('Motion is off. Drag the photo to look around.');
  else if (!sensorApisPresent()) setStatus('This browser has no motion sensors. Drag the photo to look around.');
  else if (!permissionGranted) setStatus('Tap Enable motion, then tilt your phone.');
  else setStatus('Tilt your phone gently.');
}

function updateMotionButton(): void {
  btnMotion.textContent = motionOn ? 'Motion on' : 'Motion off';
  btnMotion.setAttribute('aria-pressed', String(motionOn));
  btnEnable.hidden = permissionGranted || !motionOn;
}

btnEnable.addEventListener('click', async () => {
  try {
    permissionGranted = await requestSensorPermission();
  } catch {
    permissionGranted = false;
  }
  if (permissionGranted) {
    startSensors();
    defaultStatus();
  } else {
    setStatus('Motion access was denied. Drag the photo to look around, or allow motion in your browser settings.');
  }
  updateMotionButton();
});

btnMotion.addEventListener('click', () => {
  motionOn = !motionOn;
  settings.motionEnabled = motionOn;
  saveSettings(settings);
  if (motionOn) {
    controller.recenter();
    startSensors();
  } else {
    stopSensors();
    controller.clearTarget();
  }
  updateMotionButton();
  defaultStatus();
  requestFrame();
});

btnReset.addEventListener('click', () => {
  manualHold = { x: 0, y: 0 };
  controller.setManual(null);
  controller.recenter();
  requestFrame();
});

btnSettings.addEventListener('click', () => {
  form.hidden = !form.hidden;
  btnSettings.setAttribute('aria-expanded', String(!form.hidden));
  compositor.resize();
  dirty = true;
  requestFrame();
});

// ---- Your photo -------------------------------------------------------------

const preparer = new Preparer(() => settings.maxOffset);
let processing = false;

function setBusy(text: string | null): void {
  busy.hidden = text === null;
  busyText.textContent = text ?? '';
  for (const b of [btnPick, btnFix, btnAdd, btnRemove, btnDone]) b.disabled = text !== null;
  btnUndo.disabled = text !== null || !canUndo;
}

let canUndo = false;

function editHint(): void {
  setStatus(
    editOp === 'add'
      ? 'Tap anything that should stay still to add it.'
      : 'Tap anything that should move with the background to remove it.',
  );
}

function setEditing(on: boolean): void {
  editing = on;
  toolbar.hidden = on;
  editBar.hidden = !on;
  canvas.style.cursor = on ? 'crosshair' : '';
  // Hold the picture still and darken what is not selected.
  compositor.setDim(on ? 0.55 : 0);
  if (on) {
    controller.setManual({ x: 0, y: 0 });
    editHint();
  } else {
    controller.setManual(null);
    controller.recenter();
    defaultStatus();
  }
  dirty = true;
  requestFrame();
}

function setEditOp(op: EditMode): void {
  editOp = op;
  btnAdd.setAttribute('aria-pressed', String(op === 'add'));
  btnRemove.setAttribute('aria-pressed', String(op === 'remove'));
  editHint();
}

function formatTimings(t: Record<string, number>): string {
  return Object.entries(t)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ') + ' ms';
}

async function runPrepare(task: () => Promise<PrepareOutcome>): Promise<void> {
  if (processing) return;
  processing = true;
  setBusy('Preparing…');
  try {
    const out = await task();
    showScene(out.scene, out.hasSubject);
    lastTimings = formatTimings(out.timings);
    canUndo = out.canUndo;
    btnFix.hidden = false;
    if (editing) {
      controller.setManual({ x: 0, y: 0 });
      editHint();
    } else if (!out.hasSubject) {
      setEditing(true);
      setEditOp('add');
      setStatus('No subject found automatically. Tap the person or object that should stay still.');
    } else {
      defaultStatus();
    }
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`Could not process this photo: ${msg}`);
    // A crashed worker may have run out of memory; start fresh next time.
    preparer.reset();
  } finally {
    processing = false;
    if (!busy.hidden) setBusy(null);
  }
}

btnPick.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  setEditing(false);
  void runPrepare(async () => {
    setBusy('Opening photo…');
    let image: ImageBitmap;
    try {
      image = await decodeForProcessing(file);
    } catch (err) {
      throw err instanceof DecodeError ? err : new Error('The photo could not be opened. It may be too large for this phone.');
    }
    return preparer.process(image, (step) => setBusy(step));
  });
});

btnFix.addEventListener('click', () => {
  setEditing(true);
  setEditOp('add');
});
btnAdd.addEventListener('click', () => setEditOp('add'));
btnRemove.addEventListener('click', () => setEditOp('remove'));
btnUndo.addEventListener('click', () => void runPrepare(() => preparer.undo()));
btnDone.addEventListener('click', () => setEditing(false));

// ---- Settings panel -------------------------------------------------------

type NumKey = 'strength' | 'maxOffset' | 'tiltRange' | 'recenterSeconds' | 'minCutoff' | 'beta' | 'springOmega';
type BoolKey = 'invertX' | 'invertY' | 'showHud';
const numKeys: NumKey[] = ['strength', 'maxOffset', 'tiltRange', 'recenterSeconds', 'minCutoff', 'beta', 'springOmega'];
const boolKeys: BoolKey[] = ['invertX', 'invertY', 'showHud'];

// The UI shows degrees and percentages; settings store radians and fractions.
const toUi: Partial<Record<NumKey, (v: number) => number>> = {
  tiltRange: (v) => v * DEG,
  maxOffset: (v) => v * 100,
  strength: (v) => v * 100,
};
const fromUi: Partial<Record<NumKey, (v: number) => number>> = {
  tiltRange: (v) => v / DEG,
  maxOffset: (v) => v / 100,
  strength: (v) => v / 100,
};

function syncForm(): void {
  for (const k of numKeys) {
    const input = $<HTMLInputElement>(`s-${k}`);
    const out = $<HTMLOutputElement>(`o-${k}`);
    const ui = (toUi[k] ?? ((v: number) => v))(settings[k]);
    input.value = String(ui);
    out.textContent = Number.isInteger(ui) ? String(ui) : ui.toFixed(k === 'maxOffset' ? 2 : 1);
  }
  for (const k of boolKeys) $<HTMLInputElement>(`s-${k}`).checked = settings[k];
}

// Range inputs work in UI units.
$<HTMLInputElement>('s-strength').min = '0';
$<HTMLInputElement>('s-strength').max = '100';
$<HTMLInputElement>('s-strength').step = '5';
$<HTMLInputElement>('s-maxOffset').min = '0.5';
$<HTMLInputElement>('s-maxOffset').max = '6';
$<HTMLInputElement>('s-maxOffset').step = '0.25';

function applySettings(): void {
  controller.setParams(settings);
  scene.maxOffset = sceneHasSubject ? settings.maxOffset : 0;
  hud.hidden = !settings.showHud;
  saveSettings(settings);
  syncForm();
  dirty = true;
  requestFrame();
}

form.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  const key = t.name;
  if ((numKeys as string[]).includes(key)) {
    const k = key as NumKey;
    settings[k] = (fromUi[k] ?? ((v: number) => v))(Number(t.value));
  } else if ((boolKeys as string[]).includes(key)) {
    settings[key as BoolKey] = t.checked;
  }
  applySettings();
});
form.addEventListener('submit', (e) => e.preventDefault());
$('settings-defaults').addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS, motionEnabled: motionOn };
  applySettings();
});

// ---- Lifecycle ------------------------------------------------------------

new ResizeObserver(() => {
  compositor.resize();
  dirty = true;
  requestFrame();
}).observe(canvas);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSensors();
  else {
    controller.recenter();
    startSensors();
    dirty = true;
    requestFrame();
  }
});

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches && motionOn) {
    motionOn = false;
    stopSensors();
    controller.clearTarget();
  }
  updateMotionButton();
  defaultStatus();
  requestFrame();
});

const updateSW = registerSW({
  onNeedRefresh() {
    $('update').hidden = false;
  },
  onOfflineReady() {
    setStatus('Ready to use offline.');
    window.setTimeout(defaultStatus, 3000);
  },
});
$('update-reload').addEventListener('click', () => void updateSW(true));

syncForm();
hud.hidden = !settings.showHud;
updateMotionButton();
defaultStatus();
startSensors();
requestFrame();

// Browsers with a permission API (iOS Safari, recent Chrome) resolve immediately
// without a tap when access was already granted; otherwise they reject and the
// Enable motion button stays.
if (!permissionGranted) {
  requestSensorPermission()
    .then((granted) => {
      if (!granted || permissionGranted) return;
      permissionGranted = true;
      startSensors();
      updateMotionButton();
      defaultStatus();
    })
    .catch(() => {});
}

// Exposed for automated tests only.
(window as unknown as { __depthPhoto: unknown }).__depthPhoto = {
  get offset() {
    return { ...current };
  },
  get scene() {
    return { width: scene.width, height: scene.height, maxOffset: scene.maxOffset };
  },
  get renderer() {
    return compositor.kind;
  },
  get hasSubject() {
    return sceneHasSubject;
  },
  get busy() {
    return processing;
  },
  get status() {
    return statusEl.textContent;
  },
  /** PNG data URLs of the current layers, for debugging and tests. */
  layers() {
    const toUrl = (l: CanvasImageSource & { width: number; height: number }) => {
      const c = document.createElement('canvas');
      c.width = l.width;
      c.height = l.height;
      c.getContext('2d')!.drawImage(l, 0, 0);
      return c.toDataURL('image/png');
    };
    return { foreground: toUrl(scene.foreground), background: toUrl(scene.background) };
  },
};
