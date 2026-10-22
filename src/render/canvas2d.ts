import type { PixelOffset, PreparedScene } from '../shared/types';
import { renderScale, type Compositor } from './compositor';
import { containRect, cropRect } from './layout';

/** Fallback when WebGL2 is unavailable. Same two-layer composite, drawn with drawImage. */
export class Canvas2DCompositor implements Compositor {
  readonly kind = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D;
  private scene: PreparedScene | null = null;
  private letterbox = '#0f1518';
  private dim = 0;

  setDim(amount: number): void {
    this.dim = Math.min(Math.max(amount, 0), 1);
  }

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
  }

  setLetterbox(css: string): void {
    this.letterbox = css;
  }

  setScene(scene: PreparedScene): void {
    this.scene = scene;
  }

  resize(): void {
    const s = renderScale();
    const w = Math.max(1, Math.round(this.canvas.clientWidth * s));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * s));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(offset: PixelOffset): void {
    const scene = this.scene;
    if (!scene) return;
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const crop = cropRect(scene.width, scene.height, scene.maxOffset);
    const d = containRect(cw, ch, crop.w, crop.h);
    ctx.fillStyle = this.letterbox;
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scene.background, crop.x + offset.x, crop.y + offset.y, crop.w, crop.h, d.x, d.y, d.w, d.h);
    if (this.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.dim})`;
      ctx.fillRect(d.x, d.y, d.w, d.h);
    }
    ctx.drawImage(scene.foreground, crop.x, crop.y, crop.w, crop.h, d.x, d.y, d.w, d.h);
  }

  dispose(): void {
    this.scene = null;
  }
}
