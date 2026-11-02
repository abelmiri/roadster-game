import * as THREE from 'three';

interface HazardPosition { x: number; y: number }

/** Warm warning halos for live damaging obstacles, independent of scene lighting. */
export class HazardHalos {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec2 vUv;
      void main() {
        float r = length(vUv * 2.0 - 1.0);
        float glow = pow(1.0 - smoothstep(0.0, 1.0, r), 2.0);
        float ring = 1.0 - smoothstep(0.025, 0.10, abs(r - 0.65));
        float alpha = glow * 0.42 + ring * 0.65;
        gl_FragColor = vec4(1.0, 0.30, 0.10, alpha);
        #include <colorspace_fragment>
      }`,
  });
  private mesh = this.createMesh(32);
  private readonly pose = new THREE.Object3D();

  private createMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    return mesh;
  }

  update(hazards: readonly HazardPosition[], halfHeight: number, viewportHeight: number,
    left: number, right: number): void {
    // Preserve a visible ring on small screens as the world shrinks during a jump.
    const diameter = Math.max(3.6, 2 * halfHeight / Math.max(1, viewportHeight) * 30);
    const visible = hazards.filter(hazard => hazard.x + diameter / 2 >= left && hazard.x - diameter / 2 <= right);
    if (visible.length > this.mesh.instanceMatrix.count) {
      this.mesh.removeFromParent();
      this.mesh.dispose();
      this.mesh = this.createMesh(Math.max(visible.length, this.mesh.instanceMatrix.count * 2));
    }
    this.mesh.count = visible.length;
    visible.forEach((hazard, index) => {
      // Behind the obstacle's front face, so the glow does not wash out its silhouette.
      this.pose.position.set(hazard.x, hazard.y, 0.9);
      this.pose.scale.set(diameter, diameter, 1);
      this.pose.updateMatrix();
      this.mesh.setMatrixAt(index, this.pose.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
