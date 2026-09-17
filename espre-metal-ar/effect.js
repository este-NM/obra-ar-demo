import * as THREE from 'three';

// The magenta PNG is a raster path mask, never a visible colored layer.
export const effectSettings = { duration: 6, rest: 1.2, intensity: 0.8, bandWidth: 0.135 };
export const finishes = {
  gold: { color: '#efc45d', highlight: '#fff7d9' },
  silver: { color: '#9cbbd2', highlight: '#f4fcff' },
  copper: { color: '#d78a57', highlight: '#ffe2bd' },
};

export function createMetalMaterial(mask, original, preview = false) {
  return new THREE.ShaderMaterial({
    transparent: !preview, depthWrite: false, depthTest: false, toneMapped: false,
    uniforms: {
      uMask: { value: mask }, uOriginal: { value: original },
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
        return m.a * smoothstep(0.1,0.45, min(m.r,m.b)-m.g);
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
        float m=trace(vUv);
        // A small local halo comes only from neighboring trace pixels.
        vec2 px=uTexel*2.5;
        float halo=(trace(vUv+vec2(px.x,0.0))+trace(vUv-vec2(px.x,0.0))+
          trace(vUv+vec2(0.0,px.y))+trace(vUv-vec2(0.0,px.y)))*0.25;
        float grain=0.86+0.14*sin(vUv.x*1100.0+vUv.y*340.0+uTime*1.7);
        float glint=pow(0.5+0.5*sin(vUv.x*97.0-vUv.y*23.0-uTime*2.0),10.0);
        vec3 metal=mix(uMetal,uHighlight,clamp(head*0.85+glint*0.22,0.0,1.0));
        float alpha=clamp((m*grain+halo*0.2)*envelope*uIntensity,0.0,1.0);
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
