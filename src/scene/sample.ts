import type { PreparedScene } from '../shared/types';

/**
 * A procedurally painted test scene: a backlit hiker on a rock in front of
 * layered mountains at sunset. Because it is painted in two layers, the
 * background behind the subject is complete and the mask is exact. This lets
 * Milestone 1 judge rendering and motion on its own, before any segmentation
 * or background fill exists.
 */

const W = 1080;
const H = 1440;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D unavailable');
  return { c, g };
}

/** 1D midpoint displacement ridge, returns heights for x = 0..W step `step`. */
function ridge(rand: () => number, base: number, rough: number, step = 4): number[] {
  const n = Math.ceil(W / step) + 1;
  let size = 1;
  while (size < n - 1) size *= 2;
  const pts = new Array<number>(size + 1).fill(base);
  pts[0] = base + (rand() - 0.5) * rough;
  pts[size] = base + (rand() - 0.5) * rough;
  let amp = rough;
  for (let len = size; len > 1; len /= 2) {
    for (let i = 0; i < size; i += len) {
      const mid = i + len / 2;
      pts[mid] = ((pts[i] ?? base) + (pts[i + len] ?? base)) / 2 + (rand() - 0.5) * amp;
    }
    amp *= 0.55;
  }
  return pts.slice(0, n);
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * t));
  return `rgb(${r[0]},${r[1]},${r[2]})`;
}

const SUN = { x: W * 0.66, y: H * 0.5 };

function paintBackground(g: CanvasRenderingContext2D, rand: () => number): void {
  const sky = g.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, '#1d2a52');
  sky.addColorStop(0.45, '#6b4f7a');
  sky.addColorStop(0.78, '#e4875a');
  sky.addColorStop(1, '#f7c27a');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  const glow = g.createRadialGradient(SUN.x, SUN.y, 0, SUN.x, SUN.y, W * 0.55);
  glow.addColorStop(0, 'rgba(255,236,190,0.95)');
  glow.addColorStop(0.08, 'rgba(255,206,140,0.75)');
  glow.addColorStop(0.35, 'rgba(240,140,90,0.25)');
  glow.addColorStop(1, 'rgba(240,140,90,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Thin cloud streaks.
  for (let i = 0; i < 14; i++) {
    const y = H * (0.12 + rand() * 0.32);
    const x = rand() * W;
    const w = W * (0.2 + rand() * 0.45);
    const h = 4 + rand() * 10;
    const cg = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    const a = 0.12 + rand() * 0.2;
    cg.addColorStop(0, 'rgba(255,190,160,0)');
    cg.addColorStop(0.5, `rgba(255,190,160,${a})`);
    cg.addColorStop(1, 'rgba(255,190,160,0)');
    g.fillStyle = cg;
    g.beginPath();
    g.ellipse(x, y, w / 2, h, 0, 0, Math.PI * 2);
    g.fill();
  }

  // Mountain ranges, far to near. Colours shift from hazy violet to deep blue-black.
  const far: [number, number, number] = [176, 128, 150];
  const near: [number, number, number] = [26, 30, 48];
  const layers = [
    { base: H * 0.5, rough: 260 },
    { base: H * 0.56, rough: 220 },
    { base: H * 0.63, rough: 170 },
    { base: H * 0.7, rough: 120 },
  ];
  layers.forEach((L, li) => {
    const t = li / (layers.length - 1);
    const step = 4;
    const hs = ridge(rand, L.base, L.rough, step);
    g.beginPath();
    g.moveTo(0, H);
    hs.forEach((y, i) => g.lineTo(i * step, y));
    g.lineTo(W, H);
    g.closePath();
    const fill = g.createLinearGradient(0, L.base - L.rough, 0, H);
    fill.addColorStop(0, mix(far, near, t * 0.85));
    fill.addColorStop(1, mix(far, near, Math.min(1, t * 0.85 + 0.25)));
    g.fillStyle = fill;
    g.fill();

    // Rock texture: short strokes inside the range, so motion is easy to see.
    g.save();
    g.clip();
    g.globalAlpha = 0.08 + 0.05 * t;
    for (let k = 0; k < 900; k++) {
      const x = rand() * W;
      const yTop = hs[Math.min(hs.length - 1, Math.floor(x / step))] ?? L.base;
      const y = yTop + rand() * (H - yTop) * 0.5;
      g.strokeStyle = rand() > 0.5 ? 'rgba(255,220,200,1)' : 'rgba(0,0,0,1)';
      g.lineWidth = 1 + rand() * 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 20, y + 6 + rand() * 18);
      g.stroke();
    }
    g.restore();

    // Snow on the farthest two ranges.
    if (li < 2) {
      g.save();
      g.beginPath();
      g.moveTo(0, H);
      hs.forEach((y, i) => g.lineTo(i * step, y));
      g.lineTo(W, H);
      g.closePath();
      g.clip();
      g.fillStyle = `rgba(255,226,214,${0.35 - li * 0.12})`;
      hs.forEach((y, i) => {
        if (y < L.base - L.rough * 0.2) g.fillRect(i * step, y, step, 10 + rand() * 18);
      });
      g.restore();
    }

    // Haze that thickens with distance.
    const haze = g.createLinearGradient(0, L.base - L.rough, 0, L.base + 140);
    haze.addColorStop(0, 'rgba(248,170,120,0)');
    haze.addColorStop(1, `rgba(248,170,120,${0.22 * (1 - t)})`);
    g.fillStyle = haze;
    g.fillRect(0, L.base - L.rough, W, 400);
  });

  // Pine forest along the nearest ridge.
  const treeBase = H * 0.76;
  for (let i = 0; i < 170; i++) {
    const x = rand() * W;
    const h = 30 + rand() * 70;
    const w = h * (0.28 + rand() * 0.1);
    const y = treeBase + (rand() - 0.5) * 40;
    g.fillStyle = mix([22, 26, 36], [12, 14, 20], rand());
    g.beginPath();
    g.moveTo(x, y - h);
    g.lineTo(x + w / 2, y);
    g.lineTo(x - w / 2, y);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#0d1018';
  g.fillRect(0, treeBase + 18, W, H - treeBase);

  // Meadow tufts in the lower background.
  for (let i = 0; i < 2600; i++) {
    const x = rand() * W;
    const y = treeBase + 20 + rand() * (H - treeBase);
    g.strokeStyle = rand() > 0.6 ? 'rgba(120,80,60,0.35)' : 'rgba(40,40,52,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 6, y - 4 - rand() * 10);
    g.stroke();
  }
}

/** Rock outcrop plus a hiker, painted on a transparent canvas. */
function paintForeground(g: CanvasRenderingContext2D, rand: () => number): void {
  // Rock.
  g.beginPath();
  g.moveTo(-10, H + 10);
  g.lineTo(-10, H * 0.84);
  const rockTop: [number, number][] = [
    [W * 0.08, H * 0.82],
    [W * 0.18, H * 0.805],
    [W * 0.3, H * 0.795],
    [W * 0.4, H * 0.792],
    [W * 0.5, H * 0.8],
    [W * 0.6, H * 0.83],
    [W * 0.7, H * 0.87],
    [W * 0.8, H * 0.92],
    [W * 0.9, H * 0.97],
    [W + 10, H * 1.0],
  ];
  for (const [x, y] of rockTop) g.lineTo(x + (rand() - 0.5) * 14, y + (rand() - 0.5) * 10);
  g.lineTo(W + 10, H + 10);
  g.closePath();
  const rock = g.createLinearGradient(0, H * 0.79, 0, H);
  rock.addColorStop(0, '#3a2a2a');
  rock.addColorStop(0.25, '#1d1719');
  rock.addColorStop(1, '#0b0a0d');
  g.fillStyle = rock;
  g.fill();

  // Rock grain and a warm rim along the top edge (sun is behind and to the right).
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 1400; i++) {
    const x = rand() * W;
    const y = H * 0.79 + rand() * H * 0.21;
    g.fillStyle = rand() > 0.5 ? 'rgba(255,200,170,0.06)' : 'rgba(0,0,0,0.18)';
    g.fillRect(x, y, 2 + rand() * 6, 1 + rand() * 3);
  }
  const rim = g.createLinearGradient(0, H * 0.785, 0, H * 0.83);
  rim.addColorStop(0, 'rgba(255,170,110,0.55)');
  rim.addColorStop(1, 'rgba(255,170,110,0)');
  g.fillStyle = rim;
  g.fillRect(0, H * 0.77, W, H * 0.07);
  g.restore();

  // Hiker silhouette, standing on the rock, facing the sun.
  const fx = W * 0.36; // feet centre
  const fy = H * 0.797;
  const s = H * 0.0027; // ~1 unit per 0.27% of height; figure ≈ 140 units tall
  const P = (x: number, y: number): [number, number] => [fx + x * s, fy - y * s];
  const poly = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(...P(x, y)) : g.moveTo(...P(x, y))));
    g.closePath();
    g.fill();
  };
  g.fillStyle = '#0c0b10';
  // Legs.
  poly([[-9, 0], [-4, 0], [-1, 38], [-4, 70], [-13, 70], [-12, 38]]);
  poly([[6, 0], [12, 0], [9, 36], [5, 70], [-4, 70], [2, 36]]);
  // Boots.
  poly([[-12, 0], [-2, 0], [-2, 4], [-11, 5]]);
  poly([[4, 0], [16, 0], [15, 4], [5, 5]]);
  // Torso / jacket.
  poly([[-15, 68], [9, 68], [12, 104], [6, 118], [-12, 118], [-18, 100]]);
  // Backpack.
  poly([[-26, 74], [-14, 72], [-12, 118], [-18, 124], [-28, 116]]);
  // Arms: left hanging, right holding a pole.
  poly([[-16, 114], [-11, 114], [-14, 84], [-17, 76], [-20, 78], [-19, 90]]);
  poly([[6, 114], [11, 112], [20, 92], [24, 82], [20, 80], [14, 92]]);
  // Pole.
  g.strokeStyle = '#0c0b10';
  g.lineWidth = 2.2 * s;
  g.beginPath();
  g.moveTo(...P(22, 82));
  g.lineTo(...P(34, 0));
  g.stroke();
  // Neck and head with a beanie.
  poly([[-4, 116], [3, 116], [3, 122], [-4, 122]]);
  g.beginPath();
  g.ellipse(...P(0, 131), 8.5 * s, 10 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(...P(-1, 139), 9 * s, 5 * s, 0, 0, Math.PI * 2);
  g.fill();

  // Warm rim light on the sun-facing side of the figure.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const rl = g.createLinearGradient(fx - 10 * s, 0, fx + 20 * s, 0);
  rl.addColorStop(0, 'rgba(255,160,100,0)');
  rl.addColorStop(0.8, 'rgba(255,160,100,0.10)');
  rl.addColorStop(1, 'rgba(255,190,130,0.45)');
  g.fillStyle = rl;
  g.fillRect(fx - 40 * s, fy - 150 * s, 80 * s, 150 * s);
  g.restore();
}

export function createSampleScene(maxOffset: number): PreparedScene {
  const bg = makeCanvas();
  paintBackground(bg.g, rng(7));
  const fg = makeCanvas();
  paintForeground(fg.g, rng(11));
  return {
    width: W,
    height: H,
    background: bg.c,
    foreground: fg.c,
    maxOffset,
    label: 'Sample: hiker at sunset',
  };
}
