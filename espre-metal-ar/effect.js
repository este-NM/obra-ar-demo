import * as THREE from 'three';

// The magenta PNG is a raster path mask, never a visible colored layer.
export const effectSettings = { duration: 6, rest: 1.2, intensity: 0.8, bandWidth: 0.24,
  traceRadius: 24, haloRadius: 17 }; // Radii in original PNG pixels.
export const finishes = {
  gold: { color: '#efc45d', highlight: '#fff7d9' },
  silver: { color: '#9cbbd2', highlight: '#f4fcff' },
  copper: { color: '#d78a57', highlight: '#ffe2bd' },
};

// Build the widened light field once, not with dozens of samples each AR frame.
const fields = new WeakMap();
function lightField(mask) {
  if (fields.has(mask)) return fields.get(mask);
  const w = 1536, h = Math.round(mask.image.height * w / mask.image.width);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', {willReadFrequently:true});
  ctx.drawImage(mask.image, 0, 0, w, h);
  const source = ctx.getImageData(0, 0, w, h).data;
  const distance = new Float32Array(w * h); distance.fill(10000);
  for (let i = 0; i < distance.length; i++) {
    const p = i * 4;
    if (source[p+3] > 12 && Math.min(source[p],source[p+2])-source[p+1] > 30) distance[i] = 0;
  }
  for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=y*w+x;
    if(x) distance[i]=Math.min(distance[i],distance[i-1]+1);
    if(y) distance[i]=Math.min(distance[i],distance[i-w]+1);
    if(x&&y) distance[i]=Math.min(distance[i],distance[i-w-1]+Math.SQRT2);
    if(x<w-1&&y) distance[i]=Math.min(distance[i],distance[i-w+1]+Math.SQRT2);
  }
  for (let y=h-1;y>=0;y--) for(let x=w-1;x>=0;x--) {
    const i=y*w+x;
    if(x<w-1) distance[i]=Math.min(distance[i],distance[i+1]+1);
    if(y<h-1) distance[i]=Math.min(distance[i],distance[i+w]+1);
    if(x<w-1&&y<h-1) distance[i]=Math.min(distance[i],distance[i+w+1]+Math.SQRT2);
    if(x&&y<h-1) distance[i]=Math.min(distance[i],distance[i+w-1]+Math.SQRT2);
  }
  const data=new Uint8Array(w*h*4), ratio=w/mask.image.width;
  for(let i=0;i<distance.length;i++) {
    const d=distance[i]/ratio;
    data[i*4]=Math.round(255*(1-Math.min(1,Math.max(0,(d-effectSettings.traceRadius*.65)/(effectSettings.traceRadius*.35)))));
    data[i*4+1]=Math.round(255*Math.exp(-Math.pow(d/(effectSettings.haloRadius*.6),2)));
    data[i*4+3]=255;
  }
  const texture=new THREE.DataTexture(data,w,h); texture.flipY=true;
  texture.minFilter=texture.magFilter=THREE.LinearFilter; texture.needsUpdate=true;
  fields.set(mask,texture); return texture;
}

export function createMetalMaterial(mask, original, preview = false) {
  return new THREE.ShaderMaterial({
    transparent: !preview, depthWrite: false, depthTest: false, toneMapped: false,
    uniforms: {
      uMask: { value: lightField(mask) }, uOriginal: { value: original },
      uPreview: { value: preview ? 1 : 0 }, uTime: { value: 0 },
      uDuration: { value: effectSettings.duration }, uRest: { value: effectSettings.rest },
      uIntensity: { value: effectSettings.intensity }, uBand: { value: effectSettings.bandWidth },
      uTexel: { value: new THREE.Vector2(1 / 3072, 1 / 1572) },
      uMetal: { value: new THREE.Color(finishes.gold.color) },
      uHighlight: { value: new THREE.Color(finishes.gold.highlight) },
    },
    vertexShader: `varying vec2 vUv;
      void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uMask, uOriginal;
      uniform float uPreview,uTime,uDuration,uRest,uIntensity,uBand;
      uniform vec2 uTexel;
      uniform vec3 uMetal,uHighlight;
      float trace(vec2 p) {
        vec4 m=texture2D(uMask,p);
        return m.r;
      }
      void main(){
        float lap=mod(uTime,uDuration+uRest);
        float progress=clamp(lap/uDuration,0.0,1.0);
        // UV y starts at the bottom: the single front travels upwards.
        float front=mix(-0.12,1.12,progress);
        float d=vUv.y-front;
        float moving=1.0-step(uDuration,lap);
        float head=exp(-pow(d/(uBand*0.17),2.0));
        float wake=exp(-pow(d/(uBand*0.64),2.0))* (1.0-smoothstep(0.0,uBand*0.28,d));
        float envelope=max(head,wake*0.38)*moving;
        vec2 field=texture2D(uMask,vUv).rg;
        float m=field.r;
        float halo=field.g;
        float grain=0.86+0.14*sin(vUv.x*1100.0+vUv.y*340.0+uTime*1.7);
        float glint=pow(0.5+0.5*sin(vUv.x*97.0-vUv.y*23.0-uTime*2.0),10.0);
        vec3 metal=mix(uMetal,uHighlight,clamp(head*0.85+glint*0.22,0.0,1.0));
        float alpha=clamp((m*grain*1.4+halo*0.65)*envelope*uIntensity,0.0,1.0);
        if(uPreview>0.5){
          vec3 base=texture2D(uOriginal,vUv).rgb;
          gl_FragColor=vec4(mix(base,metal,alpha),1.0);
        } else {
          // Nothing opaque is drawn behind the moving traces in AR.
          gl_FragColor=vec4(metal,alpha);
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function applyFinish(material, name) {
  material.uniforms.uMetal.value.set(finishes[name].color);
  material.uniforms.uHighlight.value.set(finishes[name].highlight);
}
