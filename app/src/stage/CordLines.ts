/**
 * Cords, drawn as ribbons.
 *
 * A cord is a chain of straight segments between the points of its rope.
 * Each segment is one quad, widened on screen by the vertex shader: at its
 * true thickness when seen close, and never thinner than a hair's width when
 * seen from far away. The fragment shader draws what the row says about the
 * cord: two colours plied or mottled, and the dotted or dashed line of a
 * length or colour that was not recorded.
 */
import { ShaderMaterial, Vector2, Vector3, type IUniform } from 'three';
import { InstancedQuads } from './InstancedQuads';

/** What all the stage's shaders need to know about the screen. */
export interface ScreenUniforms {
  /** Size of the drawing buffer in device pixels. */
  uViewport: IUniform<Vector2>;
  /** Device pixels per CSS pixel. */
  uPixelRatio: IUniform<number>;
}

export const LineStyle = {
  solid: 0,
  /** Length not recorded. */
  dotted: 1,
  /** Colour not recorded. */
  dashed: 2,
  /** Two colours plied together. */
  barberPole: 3,
  /** Spun from more than one colour. */
  mottled: 4,
  /** The main cord: a suggestion of ply. */
  plied: 5,
} as const;

/** Flags, added together. */
export const LINE_RIM = 1; // a pale rim, so that a dark cord can be seen on a dark ground
export const LINE_NO_MINIMUM = 2; // may become too thin to see (fine detail)

const VERTEX = /* glsl */ `
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uWidth;
uniform float uMinPx;

attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aColorA;
attribute vec3 aColorB;
attribute vec4 aStyle;   // arc at the start (cm), width scale, style, flags

varying vec4 vColorA;
varying vec3 vColorB;
varying vec4 vLine;      // px from the centre line, half width (px), arc (css px), style
varying float vRim;

void main() {
  vec4 viewStart = modelViewMatrix * vec4(aStart, 1.0);
  vec4 viewEnd = modelViewMatrix * vec4(aEnd, 1.0);
  vec4 clipStart = projectionMatrix * viewStart;
  vec4 clipEnd = projectionMatrix * viewEnd;
  vec2 halfView = uViewport * 0.5;
  vec2 d = clipEnd.xy / clipEnd.w * halfView - clipStart.xy / clipStart.w * halfView;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(0.0, -1.0);
  vec2 normal = vec2(-dir.y, dir.x);

  float t = position.x;
  vec4 view = mix(viewStart, viewEnd, t);
  vec4 clip = mix(clipStart, clipEnd, t);
  float pxPerCm = projectionMatrix[1][1] * halfView.y / max(1e-4, -view.z);

  float flags = aStyle.w;
  float rim = mod(flags, 2.0);
  float noMinimum = mod(floor(flags / 2.0), 2.0);
  float width = max(uWidth * aStyle.y * pxPerCm, uMinPx * uPixelRatio * aStyle.y * (1.0 - noMinimum));
  float halfQuad = 0.5 * width + (1.0 + 0.75 * rim) * uPixelRatio;

  // widen across the segment, and run half a width past each end so that joints close
  vec2 offset = normal * position.y * halfQuad + dir * (t * 2.0 - 1.0) * 0.5 * width;
  clip.xy += offset / halfView * clip.w;
  gl_Position = clip;

  vColorA = aColorA;
  vColorB = aColorB;
  vRim = rim;
  float arcCm = aStyle.x + t * length(aEnd - aStart);
  vLine = vec4(position.y * halfQuad, 0.5 * width, arcCm * pxPerCm / uPixelRatio, aStyle.z);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uPixelRatio;
uniform vec3 uRimColor;

varying vec4 vColorA;
varying vec3 vColorB;
varying vec4 vLine;
varying float vRim;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

void main() {
  float across = abs(vLine.x);
  float halfWidth = vLine.y;
  float px = uPixelRatio;                       // one css pixel of soft edge
  float widthCss = 2.0 * halfWidth / px;
  // coverage: a soft edge, and a line under one pixel wide fades rather than vanishing abruptly
  float core = clamp((halfWidth - across) / px + 0.5, 0.0, 1.0) * min(1.0, widthCss);

  float style = vLine.w;
  float arc = vLine.z;
  vec3 color = vColorA.rgb;
  float alpha = vColorA.a;
  float detail = smoothstep(0.75, 1.3, widthCss);   // patterns need a little width to read

  if (style > 0.5 && style < 1.5) {
    alpha *= 1.0 - smoothstep(1.4, 2.2, mod(arc, 6.0));
  } else if (style > 1.5 && style < 2.5) {
    alpha *= 1.0 - smoothstep(3.6, 4.4, mod(arc, 7.0));
  } else if (style > 2.5 && style < 3.5) {
    float turn = fract((arc + vLine.x / px) / (max(widthCss, 1.0) * 4.6));
    color = mix(color, vColorB, step(0.52, turn) * detail);
  } else if (style > 3.5 && style < 4.5) {
    float fleck = hash(floor(arc / (max(widthCss, 1.0) * 1.4)));
    color = mix(color, vColorB, step(0.7, fleck) * detail);
  } else if (style > 4.5) {
    float ply = fract((arc + vLine.x / px) / (max(widthCss, 1.0) * 0.7));
    color *= 1.0 - 0.22 * step(0.6, ply) * smoothstep(3.5, 5.5, widthCss);
  }

  // a wide cord is a little darker at its edges: it is round
  float r = clamp(across / max(halfWidth, 0.5 * px), 0.0, 1.0);
  color *= 1.0 - 0.28 * r * r * smoothstep(2.0, 6.0, widthCss);

  float a = core * alpha;
  float rim = vRim * 0.17 * alpha * clamp((halfWidth + 0.75 * px - across) / px + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(color * a + uRimColor * rim * (1.0 - a), a + rim * (1.0 - a));
}
`;

export class CordLines {
  private readonly quads: InstancedQuads;

  /**
   * @param width thickness of a cord in cm
   * @param minPx least width on screen, in CSS pixels
   */
  constructor(screen: ScreenUniforms, width: number, minPx: number) {
    const material = new ShaderMaterial({
      uniforms: {
        uViewport: screen.uViewport,
        uPixelRatio: screen.uPixelRatio,
        uWidth: { value: width },
        uMinPx: { value: minPx },
        uRimColor: { value: new Vector3(235 / 255, 235 / 255, 235 / 255) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    this.quads = new InstancedQuads(material, [
      { name: 'aStart', size: 3 },
      { name: 'aEnd', size: 3 },
      { name: 'aColorA', size: 4 },
      { name: 'aColorB', size: 3 },
      { name: 'aStyle', size: 4 },
    ]);
  }

  get mesh() {
    return this.quads.mesh;
  }

  get count(): number {
    return this.quads.count;
  }

  begin(): void {
    this.quads.begin();
  }

  /**
   * One segment from a to b. Colours are 0 to 255, alpha 0 to 1. `arc` is how
   * far along its cord the segment starts, in cm, so that patterns run on
   * from one segment to the next.
   */
  add(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    red: number, green: number, blue: number, alpha: number,
    red2: number, green2: number, blue2: number,
    arc: number, widthScale: number, style: number, flags: number,
  ): void {
    const q = this.quads;
    const i = q.count;
    q.ensure(i + 1);
    const start = q.array(0);
    const end = q.array(1);
    const colorA = q.array(2);
    const colorB = q.array(3);
    const styles = q.array(4);
    start[3 * i] = ax; start[3 * i + 1] = ay; start[3 * i + 2] = az;
    end[3 * i] = bx; end[3 * i + 1] = by; end[3 * i + 2] = bz;
    colorA[4 * i] = red / 255; colorA[4 * i + 1] = green / 255; colorA[4 * i + 2] = blue / 255; colorA[4 * i + 3] = alpha;
    colorB[3 * i] = red2 / 255; colorB[3 * i + 1] = green2 / 255; colorB[3 * i + 2] = blue2 / 255;
    styles[4 * i] = arc; styles[4 * i + 1] = widthScale; styles[4 * i + 2] = style; styles[4 * i + 3] = flags;
    q.count = i + 1;
  }

  commit(): void {
    this.quads.commit();
  }

  dispose(): void {
    this.quads.dispose();
  }
}
