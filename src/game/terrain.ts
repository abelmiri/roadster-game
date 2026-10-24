import * as THREE from 'three';
import { roadHeight } from './track';

export const GROUND_FLOOR_Y = -90;

/** World coordinates keep the rock strata continuous across streamed chunks.
 * No images or per-frame texture uploads are needed. */
export function createTerrainMaterial(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTerrainPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPosition = (modelMatrix * vec4(transformed, 1.0)).xy;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vTerrainPosition;
      float rockHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float rockNoise(vec2 p) {
        vec2 cell = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(rockHash(cell), rockHash(cell + vec2(1.0, 0.0)), f.x),
          mix(rockHash(cell + vec2(0.0, 1.0)), rockHash(cell + vec2(1.0)), f.x), f.y);
      }
      vec3 terrainTint(vec2 p) {
        float coarse = rockNoise(p * vec2(0.18, 0.35));
        float bedding = sin(p.y * 2.8 + coarse * 3.4 + sin(p.x * 0.18) * 0.7);
        float stone = rockNoise(p * vec2(1.3, 2.2) + coarse * 2.0);
        float veins = 1.0 - smoothstep(0.016, 0.055, abs(stone - 0.49));
        float detail = 1.0 - smoothstep(0.3, 0.9, length(fwidth(p)) * 28.0);
        float grit = (rockNoise(p * 28.0) - 0.5) * detail;
        float value = 0.79 + coarse * 0.23 + bedding * 0.08 + grit * 0.18 - veins * 0.19;
        vec3 mineral = mix(vec3(0.91, 0.98, 1.04), vec3(1.1, 1.02, 0.88), coarse * 0.45);
        return mineral * value;
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb *= terrainTint(vTerrainPosition);');
  };
  material.customProgramCacheKey = () => 'roadster-rock-strata-v1';
  return material;
}

export function createTerrainGeometry(start: number, end: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const samples = Math.max(2, Math.ceil((end - start) / .35));
  shape.moveTo(start, roadHeight(start));
  for (let i = 1; i <= samples; i++) {
    const x = start + (end - start) * i / samples;
    shape.lineTo(x, roadHeight(x));
  }
  shape.lineTo(end, GROUND_FLOOR_Y);
  shape.lineTo(start, GROUND_FLOOR_Y);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false, curveSegments: 1 });
}

/** A narrow asphalt cap keeps the playable road distinct from the stone. */
export function createRoadCapGeometry(start: number, end: number): THREE.BufferGeometry {
  const samples = Math.max(2, Math.ceil((end - start) / .35));
  const positions: number[] = [];
  for (let i = 0; i < samples; i++) {
    const x0 = start + (end - start) * i / samples;
    const x1 = start + (end - start) * (i + 1) / samples;
    const y0 = roadHeight(x0); const y1 = roadHeight(x1);
    positions.push(x0, y0, .465, x0, y0 - .22, .465, x1, y1, .465,
      x1, y1, .465, x0, y0 - .22, .465, x1, y1 - .22, .465);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}
