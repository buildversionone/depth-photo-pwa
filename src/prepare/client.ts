import type { PreparedScene } from '../shared/types';
import type { NormPoint } from './mask';
import type { EditMode, PrepareRequest, PrepareResponse, PrepareTimings } from './protocol';

export interface PrepareOutcome {
  scene: PreparedScene;
  /** False when nothing is selected and the user should tap the subject. */
  hasSubject: boolean;
  subjects: string[];
  method: string;
  canUndo: boolean;
  timings: PrepareTimings;
}

function toCanvas(data: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return c;
}

/** Runs the preparation pipeline in a worker, one request at a time. */
export class Preparer {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: PrepareOutcome) => void; reject: (e: Error) => void; onStep?: (s: string) => void }>();

  constructor(private maxOffset: () => number) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // A classic worker: MediaPipe 0.10.x loads its WASM glue with importScripts().
    const w = new Worker(new URL('./worker.ts', import.meta.url), { name: 'prepare' });
    w.onmessage = (e: MessageEvent<PrepareResponse>) => this.handle(e.data);
    w.onerror = (e) => {
      const err = new Error(e.message || 'The image processor stopped unexpectedly.');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.reset();
    };
    this.worker = w;
    return w;
  }

  private handle(msg: PrepareResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      p.onStep?.(msg.step);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.type === 'error') {
      p.reject(new Error(msg.message));
      return;
    }
    const empty = new Uint8ClampedArray(msg.width * msg.height * 4);
    const scene: PreparedScene = {
      width: msg.width,
      height: msg.height,
      background: toCanvas(msg.background, msg.width, msg.height),
      foreground: toCanvas(msg.foreground ?? empty, msg.width, msg.height),
      // Without a subject there is nothing to separate, so hold the photo still.
      maxOffset: msg.foreground ? this.maxOffset() : 0,
      label: msg.subjects.length ? msg.subjects.join(', ') : 'photo',
    };
    p.resolve({
      scene,
      hasSubject: !!msg.foreground,
      subjects: msg.subjects,
      method: msg.method,
      canUndo: msg.canUndo,
      timings: msg.timings,
    });
  }

  private send(req: PrepareRequest, transfer: Transferable[], onStep?: (s: string) => void): Promise<PrepareOutcome> {
    const w = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject, ...(onStep ? { onStep } : {}) });
      w.postMessage(req, transfer);
    });
  }

  process(image: ImageBitmap, onStep?: (s: string) => void): Promise<PrepareOutcome> {
    const id = this.nextId++;
    return this.send({ type: 'process', id, image }, [image], onStep);
  }

  edit(mode: EditMode, point: NormPoint, onStep?: (s: string) => void): Promise<PrepareOutcome> {
    const id = this.nextId++;
    return this.send({ type: 'edit', id, mode, point }, [], onStep);
  }

  undo(): Promise<PrepareOutcome> {
    const id = this.nextId++;
    return this.send({ type: 'undo', id }, []);
  }

  /** Terminate the worker and free its memory (models reload on next use). */
  reset(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
