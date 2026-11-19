/**
 * Many small quads drawn in one call.
 *
 * Cords and knots are drawn as quads that the vertex shader places and sizes
 * on screen, so that a cord can be a hair's width at any zoom. Each quad is
 * one instance; its data lives in flat arrays that are rewritten whenever
 * something moves.
 */
import {
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  type ShaderMaterial,
} from 'three';

export interface AttributeSpec {
  name: string;
  /** Numbers per instance. */
  size: number;
}

export class InstancedQuads {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Instances written since begin(). */
  count = 0;

  private capacity: number;
  private data: Float32Array[];
  private attributes: InstancedBufferAttribute[] = [];
  private readonly specs: readonly AttributeSpec[];

  constructor(material: ShaderMaterial, specs: readonly AttributeSpec[], capacity = 512) {
    this.specs = specs;
    this.capacity = capacity;
    this.data = specs.map((s) => new Float32Array(capacity * s.size));
    this.mesh = new Mesh(this.buildGeometry(), material);
    // Instances move every frame and the shader places them, so three.js cannot cull them by bounds.
    this.mesh.frustumCulled = false;
  }

  /** The array for the i-th attribute. Do not keep it across a call to ensure(). */
  array(i: number): Float32Array {
    return this.data[i];
  }

  begin(): void {
    this.count = 0;
  }

  /** Make room for `total` instances, keeping what is already written. */
  ensure(total: number): void {
    if (total <= this.capacity) return;
    let capacity = this.capacity;
    while (capacity < total) capacity *= 2;
    this.data = this.data.map((old, i) => {
      const grown = new Float32Array(capacity * this.specs[i].size);
      grown.set(old);
      return grown;
    });
    this.capacity = capacity;
    // A geometry frees its GPU buffers only when it is disposed, so replace it whole.
    this.mesh.geometry.dispose();
    this.mesh.geometry = this.buildGeometry();
  }

  /** Send what has been written to the GPU. */
  commit(): void {
    this.attributes.forEach((attribute, i) => {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this.count * this.specs[i].size);
      attribute.needsUpdate = true;
    });
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private buildGeometry(): InstancedBufferGeometry {
    const geometry = new InstancedBufferGeometry();
    // x runs 0 to 1 along the quad, y from -1 to 1 across it
    geometry.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.attributes = this.specs.map((spec, i) => {
      const attribute = new InstancedBufferAttribute(this.data[i], spec.size);
      attribute.setUsage(DynamicDrawUsage);
      geometry.setAttribute(spec.name, attribute);
      return attribute;
    });
    geometry.instanceCount = this.count;
    return geometry;
  }
}
