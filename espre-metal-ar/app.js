import * as THREE from 'three';
import { createMetalMaterial, applyFinish, effectSettings } from './effect.js';

const $ = id => document.getElementById(id);
const aspect = 3071 / 1572;
let elapsed = 0, last = performance.now(), mindar = null, arMaterial = null;
let arStarting = false, arRunning = false, tracked = false, finish = 'gold';
const loader = new THREE.TextureLoader();
const materials = [];
const report = error => { $('error').textContent = error.message || String(error); $('error').hidden = false; };

async function loadTexture(url, colorSpace) {
  const texture = await loader.loadAsync(url);
  texture.colorSpace = colorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

try {
  const [original, mask] = await Promise.all([
    loadTexture('./assets/obra.png', THREE.SRGBColorSpace),
    loadTexture('./assets/vectors.png', THREE.NoColorSpace),
  ]);
  const previewRenderer = new THREE.WebGLRenderer({antialias:true});
  previewRenderer.setPixelRatio(Math.min(devicePixelRatio,2));
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  $('preview').appendChild(previewRenderer.domElement);
  const previewScene = new THREE.Scene();
  const previewCamera = new THREE.OrthographicCamera(-0.5,0.5,0.5/aspect,-0.5/aspect,0.1,10);
  previewCamera.position.z = 1;
  const previewMaterial = createMetalMaterial(mask,original,true);
  materials.push(previewMaterial);
  previewScene.add(new THREE.Mesh(new THREE.PlaneGeometry(1,1/aspect),previewMaterial));
  const resize = () => previewRenderer.setSize($('preview').clientWidth,$('preview').clientWidth/aspect,false);
  new ResizeObserver(resize).observe($('preview')); resize();

  function update(now) {
    const dt=Math.min((now-last)/1000,0.1); last=now;
    if(!arRunning || tracked) elapsed+=dt;
    for(const material of materials) {
      material.uniforms.uTime.value=elapsed;
      material.uniforms.uDuration.value=effectSettings.duration;
      material.uniforms.uIntensity.value=effectSettings.intensity;
    }
    if(!arRunning) previewRenderer.render(previewScene,previewCamera);
    if(arRunning) mindar.renderer.render(mindar.scene,mindar.camera);
    requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
  $('status').textContent='Probá el reflejo aquí o activá AR frente a la imagen impresa.';
  $('start').disabled=false; $('start').textContent='Activar AR';

  document.querySelectorAll('[data-finish]').forEach(button=>button.addEventListener('click',()=>{
    finish=button.dataset.finish;
    materials.forEach(material=>applyFinish(material,finish));
    document.querySelectorAll('[data-finish]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  }));
  $('duration').addEventListener('input',event=>{
    effectSettings.duration=Number(event.target.value); $('duration-value').textContent=`${effectSettings.duration} s`; elapsed=0;
  });
  $('intensity').addEventListener('input',event=>{
    effectSettings.intensity=Number(event.target.value)/100; $('intensity-value').textContent=`${event.target.value} %`;
  });
  $('replay').addEventListener('click',()=>{elapsed=0;});

  $('start').addEventListener('click',async()=>{
    if(arStarting || arRunning) return;
    arStarting=true; $('start').disabled=true; $('error').hidden=true;
    $('status').textContent='Preparando cámara y reconocimiento…';
    try {
      if(!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Abrí esta página por HTTPS para habilitar la cámara.');
      const response=await fetch('./assets/target.mind');
      if(!response.ok) throw new Error('Falta assets/target.mind. Subí la carpeta completa.');
      if(!mindar) {
        const {MindARThree}=await import('./vendor/mindar/mindar-image-three.prod.js');
        $('ar').hidden=false;
        mindar=new MindARThree({container:$('ar'),imageTargetSrc:'./assets/target.mind',maxTrack:1,
          filterMinCF:0.001,filterBeta:0.01,missTolerance:7,warmupTolerance:5,
          uiLoading:'no',uiScanning:'no',uiError:'no'});
        mindar.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
        mindar.renderer.outputColorSpace=THREE.SRGBColorSpace;
        mindar.renderer.setClearColor(0x000000,0);
        const anchor=mindar.addAnchor(0);
        arMaterial=createMetalMaterial(mask,original,false); applyFinish(arMaterial,finish); materials.push(arMaterial);
        const plane=new THREE.Mesh(new THREE.PlaneGeometry(1,1/aspect),arMaterial);
        plane.position.z=0.002; plane.renderOrder=10; anchor.group.add(plane);
        anchor.onTargetFound=()=>{tracked=true;elapsed=0;$('tracking').textContent='Tren reconocido · reflejo ascendente';};
        anchor.onTargetLost=()=>{tracked=false;$('tracking').textContent='Volvé a encuadrar la imagen del tren';};
      }
      $('ar').hidden=false;
      await mindar.start();
      arRunning=true; document.body.classList.add('ar-active');
      $('tracking').hidden=false; $('start').hidden=true; $('stop').hidden=false;
      $('status').textContent='El print es el fondo. Sólo se proyecta el reflejo sobre las curvas.';
    } catch(error) {
      if(mindar) { try { await mindar.stop(); } catch {} }
      $('ar').hidden=true; report(error); $('status').textContent='La vista previa sigue disponible.';
    } finally { arStarting=false;$('start').disabled=false; }
  });
  $('stop').addEventListener('click',async()=>{
    try { await mindar.stop(); } catch(error) { report(error); }
    arRunning=false;tracked=false;elapsed=0;
    $('ar').hidden=true;$('tracking').hidden=true;$('start').hidden=false;$('stop').hidden=true;
    document.body.classList.remove('ar-active');resize();
    $('status').textContent='Vista previa · podés volver a activar la cámara.';
  });
} catch(error) { report(error);$('status').textContent='No se pudo cargar la prueba.'; }
