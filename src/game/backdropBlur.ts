import * as THREE from 'three';

/** Blur and atmospheric haze affect only the half-resolution city pass. */
export class BackdropBlur {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { city: { value: this.target.texture }, texel: { value: new THREE.Vector2(1, 1) },
      hazeTint: { value: new THREE.Color() }, hazeOrigin: { value: new THREE.Vector2() }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform sampler2D city; uniform vec2 texel; varying vec2 vUv;
      uniform vec3 hazeTint; uniform vec2 hazeOrigin; uniform float time;
      float hazeHash(vec2 p){
        vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);
        return fract((q.x+q.y)*q.z);
      }
      float hazeNoise(vec2 p){
        vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hazeHash(i),hazeHash(i+vec2(1.,0.)),f.x),
          mix(hazeHash(i+vec2(0.,1.)),hazeHash(i+vec2(1.)),f.x),f.y);
      }
      void main(){
        vec4 c=texture2D(city,vUv)*4.;
        c+=(texture2D(city,vUv+vec2(texel.x,0.))+texture2D(city,vUv-vec2(texel.x,0.))+
            texture2D(city,vUv+vec2(0.,texel.y))+texture2D(city,vUv-vec2(0.,texel.y)))*2.;
        c+=texture2D(city,vUv+texel)+texture2D(city,vUv-texel)+
           texture2D(city,vUv+vec2(texel.x,-texel.y))+texture2D(city,vUv+vec2(-texel.x,texel.y));
        c/=16.;
        vec2 drift=vUv*vec2(4.0,3.0)+hazeOrigin+vec2(time*.008,-time*.003);
        float clouds=hazeNoise(drift)*.65+hazeNoise(drift*2.1+7.3)*.35;
        float low=1.-smoothstep(.28,.9,vUv.y);
        float haze=.055+low*(.085+clouds*.13);
        float luminance=dot(c.rgb,vec3(.2126,.7152,.0722));
        vec3 distant=mix(vec3(luminance),c.rgb,.88);
        gl_FragColor=vec4(mix(distant,hazeTint,haze),c.a);
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
    city: THREE.Group, world: THREE.Group, haze: THREE.Color, time: number): void {
    this.material.uniforms.hazeTint.value.copy(haze);
    this.material.uniforms.hazeOrigin.value.set(camera.position.x*.018,camera.position.y*.018);
    this.material.uniforms.time.value=time;
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
