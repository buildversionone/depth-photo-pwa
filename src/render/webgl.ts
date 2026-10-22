import type { LayerSource, PixelOffset, PreparedScene } from '../shared/types';
import { renderScale, type Compositor } from './compositor';
import { containRect, cropRect } from './layout';

const VERT = `#version 300 es
// One oversized triangle covering the viewport.
out vec2 vScreen;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vScreen = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Screen-space two-layer composite. The foreground is sampled at fixed
// coordinates; only the background lookup receives the motion offset.
const FRAG = `#version 300 es
precision highp float;
in vec2 vScreen;            // 0..1, y down
uniform sampler2D uBg;
uniform sampler2D uFg;      // premultiplied alpha
uniform vec4 uContent;      // content rect in screen uv: x, y, w, h
uniform vec4 uCrop;         // visible image region in image uv: x, y, w, h
uniform vec2 uOffset;       // background shift in image uv
uniform vec3 uLetterbox;
uniform float uDim;         // background darkening while editing the cutout
out vec4 outColor;
void main() {
  vec2 q = (vScreen - uContent.xy) / uContent.zw;
  if (any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0)))) {
    outColor = vec4(uLetterbox, 1.0);
    return;
  }
  vec2 uv = uCrop.xy + q * uCrop.zw;
  vec2 bgUv = clamp(uv + uOffset, vec2(0.0), vec2(1.0));
  vec4 bg = texture(uBg, bgUv) * (1.0 - uDim);
  vec4 fg = texture(uFg, uv);
  outColor = vec4(fg.rgb + bg.rgb * (1.0 - fg.a), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Could not create shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

export class WebGLCompositor implements Compositor {
  readonly kind = 'webgl2' as const;
  readonly maxTextureSize: number;
  private gl: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private bgTex: WebGLTexture | null = null;
  private fgTex: WebGLTexture | null = null;
  private scene: PreparedScene | null = null;
  private lost = false;
  private u!: Record<'bg' | 'fg' | 'content' | 'crop' | 'offset' | 'letterbox' | 'dim', WebGLUniformLocation | null>;
  private dim = 0;
  private letterbox: [number, number, number] = [0.059, 0.082, 0.094];

  /** Throws if WebGL2 is unavailable. */
  constructor(private canvas: HTMLCanvasElement, private onContextChange?: (lost: boolean) => void) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.init();
    canvas.addEventListener('webglcontextlost', this.handleLost);
    canvas.addEventListener('webglcontextrestored', this.handleRestored);
  }

  private init(): void {
    const gl = this.gl;
    const prog = gl.createProgram();
    if (!prog) throw new Error('Could not create program');
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(prog)}`);
    }
    this.program = prog;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Could not create vertex array');
    this.vao = vao;
    this.u = {
      bg: gl.getUniformLocation(prog, 'uBg'),
      fg: gl.getUniformLocation(prog, 'uFg'),
      content: gl.getUniformLocation(prog, 'uContent'),
      crop: gl.getUniformLocation(prog, 'uCrop'),
      offset: gl.getUniformLocation(prog, 'uOffset'),
      letterbox: gl.getUniformLocation(prog, 'uLetterbox'),
      dim: gl.getUniformLocation(prog, 'uDim'),
    };
  }

  setDim(amount: number): void {
    this.dim = Math.min(Math.max(amount, 0), 1);
  }

  setLetterbox(rgb: [number, number, number]): void {
    this.letterbox = rgb;
  }

  private upload(src: LayerSource, premultiply: boolean): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Could not create texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return tex;
  }

  setScene(scene: PreparedScene): void {
    if (scene.width > this.maxTextureSize || scene.height > this.maxTextureSize) {
      throw new Error(`Image ${scene.width}×${scene.height} exceeds this GPU's texture limit of ${this.maxTextureSize}px`);
    }
    this.releaseTextures();
    this.scene = scene;
    if (this.lost) return;
    this.bgTex = this.upload(scene.background, false);
    this.fgTex = this.upload(scene.foreground, true);
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
    const gl = this.gl;
    const scene = this.scene;
    if (this.lost || !scene || !this.bgTex || !this.fgTex) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const crop = cropRect(scene.width, scene.height, scene.maxOffset);
    const content = containRect(cw, ch, crop.w, crop.h);

    gl.viewport(0, 0, cw, ch);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(this.u.bg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fgTex);
    gl.uniform1i(this.u.fg, 1);
    gl.uniform4f(this.u.content, content.x / cw, content.y / ch, content.w / cw, content.h / ch);
    gl.uniform4f(this.u.crop, crop.x / scene.width, crop.y / scene.height, crop.w / scene.width, crop.h / scene.height);
    gl.uniform2f(this.u.offset, offset.x / scene.width, offset.y / scene.height);
    gl.uniform3f(this.u.letterbox, ...this.letterbox);
    gl.uniform1f(this.u.dim, this.dim);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private releaseTextures(): void {
    if (this.bgTex) this.gl.deleteTexture(this.bgTex);
    if (this.fgTex) this.gl.deleteTexture(this.fgTex);
    this.bgTex = null;
    this.fgTex = null;
  }

  private handleLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
    this.bgTex = null;
    this.fgTex = null;
    this.onContextChange?.(true);
  };

  private handleRestored = (): void => {
    this.lost = false;
    this.init();
    if (this.scene) this.setScene(this.scene);
    this.onContextChange?.(false);
  };

  dispose(): void {
    this.releaseTextures();
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored);
  }
}
