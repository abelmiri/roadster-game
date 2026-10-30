import * as THREE from 'three';

/** Full-screen grade for hit stop and slow motion: streaked edges around the
 * focus, chromatic split, cool desaturation, vignette and crawling speed lines.
 * The scene only takes this extra pass while the effect is visible; an 8-bit
 * sRGB target with light MSAA keeps its bandwidth low on mobile GPUs. */
export class SlowMotionEffect {
  readonly target = new THREE.WebGLRenderTarget(1, 1, { colorSpace: THREE.SRGBColorSpace, samples: 2 });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { frame: { value: this.target.texture }, amount: { value: 0 }, focus: { value: new THREE.Vector2(.5, .5) },
      aspect: { value: 1 }, time: { value: 0 }, resolution: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform sampler2D frame; uniform float amount; uniform vec2 focus;
      uniform float aspect; uniform float time; uniform vec2 resolution; varying vec2 vUv;
      float hash(float n){return fract(sin(n)*43758.5453);}
      void main(){
        vec2 delta=vUv-focus;
        float dist=length(vec2(delta.x*aspect,delta.y));
        float edge=smoothstep(.1,.8,dist);
        vec3 c;
        // The area around the focus stays sharp and needs a single fetch.
        if(edge*amount<.02)c=texture2D(frame,vUv).rgb;
        else{
          // Streak toward the focus, stretched along the direction of travel.
          // The outer taps carry the chromatic split, so it costs no extra fetches.
          vec2 streak=delta*vec2(1.,.4)*amount*.077*edge;
          vec2 split=delta*amount*.01*edge;
          vec3 near=texture2D(frame,vUv).rgb+texture2D(frame,vUv-streak*.33).rgb;
          vec3 far=texture2D(frame,vUv-streak*.67+split).rgb*vec3(1.,.5,0.)
            +texture2D(frame,vUv-streak-split).rgb*vec3(0.,.5,1.);
          c=near*.3+far*.4;
        }
        float luma=dot(c,vec3(.2126,.7152,.0722));
        c=mix(vec3(luma),c,1.-amount*.3);
        c*=mix(vec3(1.),vec3(.9,.99,1.1),amount);
        c=max(vec3(0.),(c-.18)*(1.+amount*.15)+.18);
        // Thin lines crawl past the car, slowed by the same clock as the world.
        float rows=resolution.y/7.;
        float row=floor(vUv.y*rows);
        float seed=hash(row);
        if(seed>.8){
          float x=fract(vUv.x+time*(.35+hash(row+3.1)*.6)+seed*13.);
          float len=.1+hash(row+7.7)*.22;
          float head=smoothstep(0.,len*.15,x)*(1.-smoothstep(len*.15,len,x));
          float thin=smoothstep(.45,1.,1.-abs(fract(vUv.y*rows)-.5)*2.);
          float lane=smoothstep(.18,.55,abs(delta.y)+abs(delta.x)*.3);
          c+=vec3(.82,.95,1.)*head*thin*lane*amount*.2;
        }
        c*=1.-smoothstep(.3,1.1,dist)*amount*.42;
        gl_FragColor=vec4(c,1.);
        #include <colorspace_fragment>
      }`,
  });
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private readonly projected = new THREE.Vector3();
  private level = 0;

  constructor() { this.scene.add(this.quad); }

  /** Eases toward the requested strength in wall time, quickly in and gently out. */
  update(strength: number, wallDelta: number): boolean {
    const target = Math.min(1, Math.max(0, strength));
    const rate = target > this.level ? 16 : 4;
    this.level += (target - this.level) * (1 - Math.exp(-Math.max(0, wallDelta) * rate));
    if (this.level < .004 && target === 0) this.level = 0;
    return this.level > 0;
  }

  resize(renderer: THREE.WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(Math.max(1, size.x), Math.max(1, size.y));
    this.material.uniforms.resolution.value.copy(size);
    this.material.uniforms.aspect.value = size.x / Math.max(1, size.y);
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, focus: { x: number; y: number }, time: number): void {
    this.projected.set(focus.x, focus.y, 1.15).project(camera);
    const uniforms = this.material.uniforms;
    uniforms.focus.value.set(THREE.MathUtils.clamp(this.projected.x * .5 + .5, .1, .9),
      THREE.MathUtils.clamp(this.projected.y * .5 + .5, .1, .9));
    uniforms.amount.value = this.level * this.level * (3 - 2 * this.level);
    uniforms.time.value = time;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void { this.target.dispose(); this.quad.geometry.dispose(); this.material.dispose(); }
}
