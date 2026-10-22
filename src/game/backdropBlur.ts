import * as THREE from 'three';

/** Blur only the city at half resolution; all playable objects remain sharp. */
export class BackdropBlur {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { city: { value: this.target.texture }, texel: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform sampler2D city; uniform vec2 texel; varying vec2 vUv;
      void main(){
        vec4 c=texture2D(city,vUv)*4.;
        c+=(texture2D(city,vUv+vec2(texel.x,0.))+texture2D(city,vUv-vec2(texel.x,0.))+
            texture2D(city,vUv+vec2(0.,texel.y))+texture2D(city,vUv-vec2(0.,texel.y)))*2.;
        c+=texture2D(city,vUv+texel)+texture2D(city,vUv-texel)+
           texture2D(city,vUv+vec2(texel.x,-texel.y))+texture2D(city,vUv+vec2(-texel.x,texel.y));
        gl_FragColor=c/16.;
        #include <colorspace_fragment>
      }`,
  });
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);

  constructor() { this.scene.add(this.quad); }

  resize(renderer: THREE.WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const width = Math.max(1, Math.round(size.x * 0.5));
    const height = Math.max(1, Math.round(size.y * 0.5));
    this.target.setSize(width, height);
    this.material.uniforms.texel.value.set(1.85 / width, 1.85 / height);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
    city: THREE.Group, world: THREE.Group): void {
    world.visible = false;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    city.visible = false;
    world.visible = true;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.autoClear = true;
    city.visible = true;
  }

  dispose(): void { this.target.dispose(); this.quad.geometry.dispose(); this.material.dispose(); }
}
