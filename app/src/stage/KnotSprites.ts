/**
 * Knots, and the grains they fall apart into.
 *
 * Each cluster of knots is one quad, placed on its cord and turned to lie
 * along it. The fragment shader draws the shape the row describes:
 *
 *   single knots   a stack of dots, one per knot
 *   long knot      a bar, with its turns slanting the way the knot was tied
 *                  (S like "\", Z like "/") when seen close enough
 *   figure-eight   a ring
 *
 * Grains are plain dots drawn by the same shader.
 */
import { ShaderMaterial } from 'three';
import type { ScreenUniforms } from './CordLines';
import { InstancedQuads } from './InstancedQuads';

export const KnotShape = {
  singles: 0,
  long: 1,
  ring: 2,
  dot: 3,
  /** A ring that may become too small to see: the loop of a doubled end. */
  fineRing: 4,
} as const;

const VERTEX = /* glsl */ `
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uRadius;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uFadeBelow;

attribute vec3 aPlace;
attribute vec3 aAlong;
attribute vec4 aColor;
attribute vec4 aShape;   // shape, count or turns, slant (S 1, Z -1), size scale

varying vec4 vColor;
varying vec4 vShape;
varying vec2 vLocal;     // px: across the cord, along it
varying vec3 vSize;      // radius, length along, half width (px)

void main() {
  vec4 view = modelViewMatrix * vec4(aPlace, 1.0);
  vec4 clip = projectionMatrix * view;
  vec4 ahead = projectionMatrix * (modelViewMatrix * vec4(aPlace + aAlong, 1.0));
  vec2 halfView = uViewport * 0.5;
  vec2 d = ahead.xy / ahead.w * halfView - clip.xy / clip.w * halfView;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(0.0, -1.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float pxPerCm = projectionMatrix[1][1] * halfView.y / max(1e-4, -view.z);

  float shape = aShape.x;
  float n = max(1.0, aShape.y);
  float r = uRadius * aShape.w * pxPerCm;
  if (shape < 3.5) r = max(r, uMinPx * uPixelRatio * aShape.w);
  if (uMaxPx > 0.0) r = min(r, uMaxPx * uPixelRatio);

  float from;
  float to;
  float halfWidth;
  if (shape < 0.5) { from = -r; to = (n - 1.0) * 2.1 * r + r; halfWidth = r; }
  else if (shape < 1.5) { from = 0.0; to = max(2.2 * r, n * 0.95 * r); halfWidth = 1.15 * r; }
  else if (shape < 2.5 || shape > 3.5) { from = -1.6 * r; to = 1.6 * r; halfWidth = 1.6 * r; }
  else { from = -r; to = r; halfWidth = r; }

  float pad = uPixelRatio;
  float along = mix(from - pad, to + pad, position.x);
  float across = position.y * (halfWidth + pad);
  clip.xy += (dir * along + normal * across) / halfView * clip.w;
  gl_Position = clip;

  vLocal = vec2(across, along);
  vSize = vec3(r, to, halfWidth);
  vShape = aShape;
  vColor = aColor;
  // seen from very far away, knots would only be noise
  if (uFadeBelow > 0.0) vColor.a *= smoothstep(uFadeBelow * 0.75, uFadeBelow, pxPerCm / uPixelRatio);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uPixelRatio;

varying vec4 vColor;
varying vec4 vShape;
varying vec2 vLocal;
varying vec3 vSize;

void main() {
  float px = uPixelRatio;
  float r = vSize.x;
  float shape = vShape.x;
  float n = max(1.0, vShape.y);
  float cover = 0.0;
  float shade = 1.0;

  if (shape < 0.5) {
    float which = clamp(floor((vLocal.y + 1.05 * r) / (2.1 * r)), 0.0, n - 1.0);
    vec2 q = vec2(vLocal.x, vLocal.y - which * 2.1 * r);
    cover = clamp((r - length(q)) / px + 0.5, 0.0, 1.0);
  } else if (shape < 1.5) {
    float tall = vSize.y;
    vec2 q = vec2(abs(vLocal.x) - vSize.z, abs(vLocal.y - 0.5 * tall) - 0.5 * tall);
    cover = clamp(-max(q.x, q.y) / px + 0.5, 0.0, 1.0);
    // the turns of the knot, slanting with its direction
    float turn = (vLocal.y - vShape.z * 0.435 * vLocal.x) * n / tall;
    float fromLine = abs(fract(turn) - 0.5) * tall / n;
    float line = 1.0 - smoothstep(0.4 * px, 1.2 * px, fromLine);
    shade = 1.0 - 0.55 * line * smoothstep(2.0, 2.8, r / px);
  } else if (shape < 2.5 || shape > 3.5) {
    float stroke = max(0.8 * px, 0.55 * r);
    cover = clamp((0.5 * stroke - abs(length(vLocal) - 1.3 * r)) / px + 0.5, 0.0, 1.0);
    if (shape > 3.5) cover *= min(1.0, r / px);
  } else {
    cover = clamp((r - length(vLocal)) / px + 0.5, 0.0, 1.0);
  }

  float a = cover * vColor.a;
  gl_FragColor = vec4(vColor.rgb * shade * a, a);
}
`;

export interface KnotSpriteOptions {
  /** Radius of a single knot in cm. */
  radius: number;
  /** Least radius on screen, CSS pixels. */
  minPx: number;
  /** Greatest radius on screen, CSS pixels; 0 for no limit. */
  maxPx?: number;
  /** Fade out when a centimetre is fewer than this many CSS pixels; 0 never fades. */
  fadeBelow?: number;
}

export class KnotSprites {
  private readonly quads: InstancedQuads;

  constructor(screen: ScreenUniforms, options: KnotSpriteOptions) {
    const material = new ShaderMaterial({
      uniforms: {
        uViewport: screen.uViewport,
        uPixelRatio: screen.uPixelRatio,
        uRadius: { value: options.radius },
        uMinPx: { value: options.minPx },
        uMaxPx: { value: options.maxPx ?? 0 },
        uFadeBelow: { value: options.fadeBelow ?? 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    this.quads = new InstancedQuads(material, [
      { name: 'aPlace', size: 3 },
      { name: 'aAlong', size: 3 },
      { name: 'aColor', size: 4 },
      { name: 'aShape', size: 4 },
    ]);
  }

  get mesh() {
    return this.quads.mesh;
  }

  get count(): number {
    return this.quads.count;
  }

  set radius(cm: number) {
    this.quads.mesh.material.uniforms.uRadius.value = cm;
  }

  begin(): void {
    this.quads.begin();
  }

  /** Forget everything from instance `count` on. */
  truncate(count: number): void {
    this.quads.count = Math.min(this.quads.count, count);
  }

  /**
   * One knot cluster or grain at (x, y, z), lying along the unit direction
   * (dx, dy, dz). Colours are 0 to 255, alpha 0 to 1.
   */
  add(
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number,
    red: number, green: number, blue: number, alpha: number,
    shape: number, count: number, slant: number, sizeScale: number,
  ): void {
    const q = this.quads;
    const i = q.count;
    q.ensure(i + 1);
    const place = q.array(0);
    const along = q.array(1);
    const color = q.array(2);
    const shapes = q.array(3);
    place[3 * i] = x; place[3 * i + 1] = y; place[3 * i + 2] = z;
    along[3 * i] = dx; along[3 * i + 1] = dy; along[3 * i + 2] = dz;
    color[4 * i] = red / 255; color[4 * i + 1] = green / 255; color[4 * i + 2] = blue / 255; color[4 * i + 3] = alpha;
    shapes[4 * i] = shape; shapes[4 * i + 1] = count; shapes[4 * i + 2] = slant; shapes[4 * i + 3] = sizeScale;
    q.count = i + 1;
  }

  /** Move an instance that is already written. */
  move(i: number, x: number, y: number, z: number): void {
    const place = this.quads.array(0);
    place[3 * i] = x; place[3 * i + 1] = y; place[3 * i + 2] = z;
  }

  commit(): void {
    this.quads.commit();
  }

  dispose(): void {
    this.quads.dispose();
  }
}
