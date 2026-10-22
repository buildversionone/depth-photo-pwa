import type { NormPoint, Size } from './mask';

/**
 * Subject suggestions, following the owner's segmentation spike (2026-10-21):
 * an EfficientDet-Lite0 detector proposes subjects, the centre of each box
 * becomes a MagicTouch point, and a centre check covers anything outside the
 * detector's 80 classes.
 */

export interface Detection {
  label: string;
  score: number;
  /** Box in pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Suggestion {
  point: NormPoint;
  label: string;
  score: number;
}

/** Surfaces things sit on, not subjects. */
const BACKGROUND_CLASSES = new Set(['dining table', 'bed', 'couch', 'bench']);

/**
 * Turn raw detections into foreground subjects: drop surfaces, specks and weak
 * hits, keep the biggest, most confident few. For a depth photo every
 * prominent subject should stay still, so more than one can be returned.
 */
export function suggestSubjects(dets: Detection[], size: Size, max = 4): Suggestion[] {
  const total = size.width * size.height;
  const scored = dets
    .filter((d) => !BACKGROUND_CLASSES.has(d.label))
    .map((d) => ({ d, area: (d.width * d.height) / total }))
    .filter(({ d, area }) => area >= 0.015 && d.score >= 0.3)
    .sort((a, b) => b.area * b.d.score - a.area * a.d.score);
  if (scored.length === 0) return [];
  // Secondary subjects must be reasonably prominent next to the main one.
  const lead = scored[0]!.area * scored[0]!.d.score;
  return scored
    .filter((s) => s.area * s.d.score >= lead * 0.15)
    .slice(0, max)
    .map(({ d }) => ({
      point: { x: (d.x + d.width / 2) / size.width, y: (d.y + d.height / 2) / size.height },
      label: d.label,
      score: d.score,
    }));
}

/**
 * Class-agnostic fallback: given a MagicTouch mask from a centre tap, return a
 * point on the subject if the mask looks like one object (neither tiny nor
 * most of the frame).
 */
export function subjectFromMask(conf: Float32Array, size: Size): Suggestion | null {
  const { width: w } = size;
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < conf.length; i++) {
    if (conf[i]! < 0.5) continue;
    n++;
    sx += i % w;
    sy += Math.floor(i / w);
  }
  const coverage = n / conf.length;
  if (coverage < 0.01 || coverage > 0.85) return null;
  // The centroid can fall outside a ring-shaped subject; use the nearest pixel on it.
  const cx = sx / n;
  const cy = sy / n;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < conf.length; i++) {
    if (conf[i]! < 0.5) continue;
    const d = ((i % w) - cx) ** 2 + (Math.floor(i / w) - cy) ** 2;
    if (d < bestD) (bestD = d), (best = i);
  }
  return {
    point: { x: ((best % w) + 0.5) / w, y: (Math.floor(best / w) + 0.5) / size.height },
    label: 'subject',
    score: 0,
  };
}
