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

/** Grey regolith with overlapping impact craters, in the same vertex-color-free,
 * world-locked style as the rock-strata material above. */
export function createMoonTerrainMaterial(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color, flatShading: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMoonPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMoonPosition = (modelMatrix * vec4(transformed, 1.0)).xy;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vMoonPosition;
      float moonHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float moonNoise(vec2 p) {
        vec2 cell = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(moonHash(cell), moonHash(cell + vec2(1.0, 0.0)), f.x),
          mix(moonHash(cell + vec2(0.0, 1.0)), moonHash(cell + vec2(1.0)), f.x), f.y);
      }
      float craterField(vec2 p) {
        vec2 cell = floor(p);
        float nearest = 8.0;
        for (int dy = -1; dy <= 1; dy++) {
          for (int dx = -1; dx <= 1; dx++) {
            vec2 c = cell + vec2(float(dx), float(dy));
            vec2 jitter = vec2(moonHash(c), moonHash(c + vec2(17.0, 31.0)));
            vec2 center = c + jitter;
            float radius = 0.22 + moonHash(c + vec2(91.0, 7.0)) * 0.3;
            nearest = min(nearest, length(p - center) / radius);
          }
        }
        float rim = (1.0 - smoothstep(0.65, 1.0, nearest)) * smoothstep(0.78, 1.0, nearest);
        float bowl = 1.0 - smoothstep(0.0, 0.95, nearest);
        return rim * 0.55 - bowl * 0.4;
      }
      vec3 moonTint(vec2 p) {
        float craters = craterField(p * 0.42) + craterField(p * 1.1 + 11.0) * 0.55;
        float maria = moonNoise(p * 0.05) - 0.5;
        float grain = (moonNoise(p * 9.0) - 0.5) * 0.14 + (moonNoise(p * 34.0) - 0.5) * 0.08;
        float value = 0.72 + craters * 0.5 + maria * 0.22 + grain;
        vec3 regolith = vec3(1.0, 0.98, 0.95);
        return regolith * clamp(value, 0.18, 1.25);
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb *= moonTint(vMoonPosition);');
  };
  material.customProgramCacheKey = () => 'roadster-moon-regolith-v1';
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

/** Fine speckle grain over the asphalt cap, layered on top of its vertex-color bevel. */
export function createRoadCapMaterial(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color, vertexColors: true, flatShading: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoadPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoadPosition = (modelMatrix * vec4(transformed, 1.0)).xy;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vRoadPosition;
      float asphaltHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float asphaltGrain(vec2 p) {
        vec2 cell = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(asphaltHash(cell), asphaltHash(cell + vec2(1.0, 0.0)), f.x),
          mix(asphaltHash(cell + vec2(0.0, 1.0)), asphaltHash(cell + vec2(1.0)), f.x), f.y);
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float grain = (asphaltGrain(vRoadPosition * 11.0) - 0.5) * 0.16 + (asphaltGrain(vRoadPosition * 40.0) - 0.5) * 0.09;
      diffuseColor.rgb *= 1.0 + grain;`);
  };
  material.customProgramCacheKey = () => 'roadster-asphalt-grain-v1';
  return material;
}

/** A narrow asphalt cap keeps the playable road distinct from the stone.
 * A brighter top edge and darker underside fake a glossy bevel along the strip. */
export function createRoadCapGeometry(start: number, end: number): THREE.BufferGeometry {
  const samples = Math.max(2, Math.ceil((end - start) / .35));
  const TOP_SHEEN = 1.28;
  const BOTTOM_SHADE = 0.7;
  const positions: number[] = [];
  const shades: number[] = [];
  const pushVertex = (x: number, y: number, shade: number): void => {
    positions.push(x, y, .465);
    shades.push(shade, shade, shade);
  };
  for (let i = 0; i < samples; i++) {
    const x0 = start + (end - start) * i / samples;
    const x1 = start + (end - start) * (i + 1) / samples;
    const y0 = roadHeight(x0); const y1 = roadHeight(x1);
    pushVertex(x0, y0, TOP_SHEEN); pushVertex(x0, y0 - .22, BOTTOM_SHADE); pushVertex(x1, y1, TOP_SHEEN);
    pushVertex(x1, y1, TOP_SHEEN); pushVertex(x0, y0 - .22, BOTTOM_SHADE); pushVertex(x1, y1 - .22, BOTTOM_SHADE);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A soft, additive glow trailing beneath the road's highlighted edge line. */
export function createRoadGlowGeometry(start: number, end: number): THREE.BufferGeometry {
  const samples = Math.max(2, Math.ceil((end - start) / .35));
  const GLOW_DROP = 0.46;
  const positions: number[] = [];
  const colors: number[] = [];
  const pushVertex = (x: number, y: number, alpha: number): void => {
    positions.push(x, y, .5);
    colors.push(1, 1, 1, alpha);
  };
  for (let i = 0; i < samples; i++) {
    const x0 = start + (end - start) * i / samples;
    const x1 = start + (end - start) * (i + 1) / samples;
    const y0 = roadHeight(x0) + .04; const y1 = roadHeight(x1) + .04;
    pushVertex(x0, y0, .6); pushVertex(x0, y0 - GLOW_DROP, 0); pushVertex(x1, y1, .6);
    pushVertex(x1, y1, .6); pushVertex(x0, y0 - GLOW_DROP, 0); pushVertex(x1, y1 - GLOW_DROP, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  return geometry;
}
