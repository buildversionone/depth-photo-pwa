import type { NormPoint } from './mask';

export type EditMode = 'add' | 'remove';

export type PrepareRequest =
  | { type: 'process'; id: number; image: ImageBitmap }
  | { type: 'edit'; id: number; mode: EditMode; point: NormPoint }
  | { type: 'undo'; id: number };

export interface PrepareTimings {
  [step: string]: number;
}

export type PrepareResponse =
  | { type: 'progress'; id: number; step: string }
  | {
      type: 'result';
      id: number;
      width: number;
      height: number;
      /** Straight-alpha RGBA; null when nothing is selected. */
      foreground: Uint8ClampedArray | null;
      background: Uint8ClampedArray;
      /** Names of the subjects found automatically, if any. */
      subjects: string[];
      method: 'detector' | 'centre' | 'edit' | 'none';
      canUndo: boolean;
      timings: PrepareTimings;
    }
  | { type: 'error'; id: number; message: string };
