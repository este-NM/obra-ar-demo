import * as THREE from "three";
import { MindARThree } from "mindar-image-three";
import { CONFIG } from "./config.js";
import { CurrentDynamicsEngine } from "./current-dynamics-engine.js";
import { GestureController } from "./gesture-controller.js";
import { InteractionEngine } from "./interaction-engine.js";
import { ProjectionEngine } from "./projection-engine.js";
import { StateEngine } from "./state-engine.js";
import { CurrentCentralityEffect } from "./current-centrality-effect.js";
import { deriveIntegratedVisualState } from "./integrated-visual-state.js";
import { visualConfig } from "./visual-config.js";
import { VisualEngine, loadVisualImage } from "./visual-engine.js";

// Proporción física y parámetros de tracking conservados de
// obras_ar_stable/previo.html, que utiliza este mismo print y target MindAR.
const TARGET_HEIGHT = 28.6 / 40.5;
const TARGET_URL = "./obras_ar_stable/targetsprevio.mind";
const COMPOSITE_WIDTH = 1260;
const CENTER_NDC = new THREE.Vector2(0, 0);

const container = document.querySelector("#ar-container");
const startPanel = document.querySelector("#start-panel");
const startButton = document.querySelector("#start");
const statusElement = document.querySelector("#status");
const errorElement = document.querySelector("#error");
const trackingHint = document.querySelector("#tracking-hint");
const centerMark = document.querySelector("#center-mark");
const trackingBadge = document.querySelector("#tracking-badge");

const diagnosticFields = {
  tracking: document.querySelector("#diag-tracking"),
  current: document.querySelector("#diag-current"),
  implicated: document.querySelector("#diag-implicated"),
  currentSubmode: document.querySelector("#diag-current-submode"),
  active: document.querySelector("#diag-active"),
  relation: document.querySelector("#diag-relation"),
  expression: document.querySelector("#diag-expression"),
  latentSource: document.querySelector("#diag-latent-source"),
  kineticSource: document.querySelector("#diag-kinetic-source"),
  motion: document.querySelector("#diag-motion"),
  uv: document.querySelector("#diag-uv"),
  hold: document.querySelector("#diag-hold"),
};

const compositeCanvas = document.createElement("canvas");
const currentCanvas = document.createElement("canvas");

let lastStructuralEvent = null;
const receiveStructuralEvent = (event) => {
  lastStructuralEvent = event;
};

const stateEngine = new StateEngine(CONFIG, receiveStructuralEvent);
const interactionEngine = new InteractionEngine(CONFIG, stateEngine, receiveStructuralEvent);
const gestureController = new GestureController(CONFIG, interactionEngine);
const projectionEngine = new ProjectionEngine(CONFIG);
const currentDynamicsEngine = new CurrentDynamicsEngine(CONFIG);

let mindarThree = null;
let renderer = null;
let scene = null;
let camera = null;
let anchor = null;
let outputPlane = null;
let outputTexture = null;
let raycaster = null;
let visualEngine = null;
let currentEffect = null;
let ready = false;
let started = false;
let trackingFound = false;
let trackingState = "not-started";
let visualElapsed = 0;
let lastFrameTime = performance.now();
let lastDiagnosticUpdate = -Infinity;
let centralUv = { active: false, u: 0.5, v: 0.5 };

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function setStatus(message, error = null) {
  statusElement.textContent = message;
  if (error) {
    errorElement.textContent = error?.message || String(error);
    errorElement.hidden = false;
  } else {
    errorElement.hidden = true;
  }
}

function setTrackingUi(state) {
  const found = state === "found";
  trackingState = state;
  trackingBadge.textContent = state;
  trackingBadge.dataset.found = String(found);
  centerMark.dataset.found = String(found);
  diagnosticFields.tracking.textContent = state;

  if (state === "found") {
    trackingHint.textContent = "Print reconocido · tap: traversal · hold: implicación o dominancia";
  } else if (state === "lost") {
    trackingHint.textContent = "Seguimiento perdido. Volvé a encuadrar el print completo.";
  } else if (state === "searching") {
    trackingHint.textContent = "Buscando el print completo…";
  }
}

async function verifyRequiredFiles() {
  const urls = [
    TARGET_URL,
    ...Object.values(visualConfig.assets),
  ];
  for (const url of new Set(urls)) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Falta el recurso requerido: ${url}`);
  }
}

async function initializeCompositeRenderer() {
  const imageNames = ["original", "s1", "s2", "s3", "ent1", "ent2"];
  const images = Object.fromEntries(
    await Promise.all(
      imageNames.map(async (name) => [name, await loadVisualImage(visualConfig.assets[name])]),
    ),
  );

  const expectedSize = `${images.original.naturalWidth}x${images.original.naturalHeight}`;
  for (const name of imageNames.slice(1)) {
    const actualSize = `${images[name].naturalWidth}x${images[name].naturalHeight}`;
    if (actualSize !== expectedSize) {
      throw new Error(`${name} no está alineado: ${actualSize}; se esperaba ${expectedSize}.`);
    }
  }

  const compositeHeight = Math.round(
    COMPOSITE_WIDTH * (images.original.naturalHeight / images.original.naturalWidth),
  );
  visualEngine = new VisualEngine(compositeCanvas, visualConfig, images, {
    renderBaseImage: false,
  });
  visualEngine.resize(COMPOSITE_WIDTH, compositeHeight);

  currentEffect = new CurrentCentralityEffect(currentCanvas, visualConfig.current);
  currentEffect.resize(COMPOSITE_WIDTH, compositeHeight);
  await currentEffect.initialize(
    visualConfig.assets.currentTraces,
    visualConfig.assets.currentGlow,
  );
}

function sampleCentralUv() {
  if (!trackingFound || !raycaster || !camera || !outputPlane) {
    return { active: false, u: centralUv.u, v: centralUv.v };
  }

  scene.updateMatrixWorld(true);
  raycaster.setFromCamera(CENTER_NDC, camera);
  const hit = raycaster.intersectObject(outputPlane, false)[0];
  if (!hit?.uv) return { active: false, u: centralUv.u, v: centralUv.v };

  // Three entrega v desde abajo; los canvas 2D y CURRENT usan v desde arriba.
  return {
    active: true,
    u: clamp01(hit.uv.x),
    v: clamp01(1 - hit.uv.y),
  };
}

function renderCompositeFrame(visualState, stateSnapshot) {
  visualEngine.setMode(visualState.primaryId);
  const primaryDiagnostics = visualEngine.render(visualElapsed, {
    phase: visualState.primaryPhase,
  });
  const presenceDiagnostics = {};
  let currentDiagnostics = currentEffect.diagnostics;

  if (visualState.currentVisible) {
    if (visualState.currentCentralityVisible) {
      if (centralUv.active) {
        currentEffect.setPointer(centralUv.u, centralUv.v, visualElapsed);
      } else {
        currentEffect.clearPointer();
      }
      currentDiagnostics = currentEffect.render(visualElapsed);
      visualEngine.compositeOverlay(currentCanvas);
    } else {
      currentEffect.clear();
    }

    for (const layerId of visualState.presenceLayers) {
      presenceDiagnostics[layerId] = visualEngine.renderPresence(
        layerId,
        visualElapsed,
        visualState.presencePhases[layerId],
        visualState.presenceOpacity,
      );
    }
  } else {
    currentEffect.clear();
  }

  outputTexture.needsUpdate = true;
  return { primaryDiagnostics, presenceDiagnostics, currentDiagnostics, stateSnapshot };
}

function updateDiagnostics(
  now,
  stateSnapshot,
  interactionSnapshot,
  projectionSnapshot,
  gestureSnapshot,
  currentDynamicsSnapshot,
  visualState,
) {
  if (now - lastDiagnosticUpdate < 100) return;
  lastDiagnosticUpdate = now;

  diagnosticFields.current.textContent = stateSnapshot.current;
  diagnosticFields.implicated.textContent = stateSnapshot.implicated;
  diagnosticFields.currentSubmode.textContent = currentDynamicsSnapshot.suspended
    ? `${currentDynamicsSnapshot.submode} (suspendido)`
    : currentDynamicsSnapshot.submode;
  diagnosticFields.active.textContent = interactionSnapshot.activeId ?? "—";
  diagnosticFields.relation.textContent = projectionSnapshot.operationalRelation;
  diagnosticFields.expression.textContent = projectionSnapshot.effectiveExpression;
  diagnosticFields.latentSource.textContent = currentDynamicsSnapshot.latentSourceId;
  diagnosticFields.kineticSource.textContent =
    currentDynamicsSnapshot.kineticCarrySourceId ?? "—";
  diagnosticFields.motion.textContent = currentDynamicsSnapshot.filteredSpeed.toFixed(3);
  diagnosticFields.uv.textContent = centralUv.active
    ? `${centralUv.u.toFixed(3)}, ${centralUv.v.toFixed(3)}`
    : "—";
  diagnosticFields.hold.textContent = interactionSnapshot.holding
    ? `${gestureSnapshot.gestureMode} · ${interactionSnapshot.holdElapsed.toFixed(2)} s`
    : gestureSnapshot.gestureMode;

  container.dataset.ready = String(ready);
  container.dataset.tracking = trackingState;
  container.dataset.current = stateSnapshot.current;
  container.dataset.implicated = stateSnapshot.implicated;
  container.dataset.currentSubmode = currentDynamicsSnapshot.submode;
  container.dataset.currentDynamicsSuspended = String(currentDynamicsSnapshot.suspended);
  container.dataset.filteredMotion = currentDynamicsSnapshot.filteredSpeed.toFixed(6);
  container.dataset.centralUv = centralUv.active
    ? `${centralUv.u.toFixed(6)},${centralUv.v.toFixed(6)}`
    : "";
  container.dataset.active = interactionSnapshot.activeId ?? "";
  container.dataset.displayMode = visualState.displayMode;
  container.dataset.gestureMode = gestureSnapshot.gestureMode;
  container.dataset.relation = projectionSnapshot.operationalRelation;
  container.dataset.effectiveExpression = projectionSnapshot.effectiveExpression;
  container.dataset.latentSource = currentDynamicsSnapshot.latentSourceId;
  container.dataset.kineticCarrySource = currentDynamicsSnapshot.kineticCarrySourceId ?? "";
  container.dataset.lastEvent = lastStructuralEvent?.type ?? "";
}

function updateFrame(now = performance.now()) {
  const elapsedDt = Math.max(0, (now - lastFrameTime) / 1000);
  const dt = Math.min(0.05, elapsedDt);
  const currentDynamicsDt = Math.min(0.25, elapsedDt);
  lastFrameTime = now;
  visualElapsed += dt;

  centralUv = sampleCentralUv();
  gestureController.update(now);

  const automaticCurrentEnabled =
    trackingFound &&
    interactionEngine.mode === "idle" &&
    gestureController.gestureMode !== "implicated-hold";
  const stateBeforeInteraction = stateEngine.snapshot(interactionEngine.activeId);
  currentDynamicsEngine.update(currentDynamicsDt, {
    automaticEnabled: automaticCurrentEnabled,
    pointer: centralUv,
    stateSnapshot: stateBeforeInteraction,
  });

  const currentContext = automaticCurrentEnabled
    ? currentDynamicsEngine.getStructuralContext()
    : gestureController.gestureMode === "implicated-hold"
      ? { phaseIds: [stateEngine.implicated] }
      : {};

  // Única integración estructural del frame, igual que en el simulador web.
  interactionEngine.update(dt, currentContext);
  gestureController.afterInteractionUpdate();

  const interactionSnapshot = interactionEngine.snapshot();
  const gestureSnapshot = gestureController.snapshot();
  const currentDynamicsSnapshot = currentDynamicsEngine.snapshot();
  const stateSnapshot = stateEngine.snapshot(interactionSnapshot.activeId);
  const projectionSnapshot = projectionEngine.project(stateSnapshot);
  const visualState = deriveIntegratedVisualState(
    CONFIG,
    stateSnapshot,
    interactionSnapshot,
    projectionSnapshot,
    gestureSnapshot,
    currentDynamicsSnapshot,
  );

  renderCompositeFrame(visualState, stateSnapshot);
  updateDiagnostics(
    now,
    stateSnapshot,
    interactionSnapshot,
    projectionSnapshot,
    gestureSnapshot,
    currentDynamicsSnapshot,
    visualState,
  );
  renderer.render(scene, camera);
}

async function setupAR() {
  mindarThree = new MindARThree({
    container,
    imageTargetSrc: TARGET_URL,
    filterMinCF: 0.001,
    filterBeta: 0.01,
    missTolerance: 7,
    warmupTolerance: 5,
    uiLoading: "no",
    uiScanning: "no",
    uiError: "no",
  });

  ({ renderer, scene, camera } = mindarThree);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  anchor = mindarThree.addAnchor(0);
  raycaster = new THREE.Raycaster();
  outputTexture = new THREE.CanvasTexture(compositeCanvas);
  outputTexture.colorSpace = THREE.SRGBColorSpace;
  outputTexture.minFilter = THREE.LinearFilter;
  outputTexture.magFilter = THREE.LinearFilter;
  outputTexture.generateMipmaps = false;

  const material = new THREE.MeshBasicMaterial({
    map: outputTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  outputPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, TARGET_HEIGHT), material);
  outputPlane.position.z = 0.006;
  outputPlane.renderOrder = 20;
  anchor.group.add(outputPlane);

  anchor.onTargetFound = () => {
    trackingFound = true;
    setTrackingUi("found");
  };

  anchor.onTargetLost = () => {
    trackingFound = false;
    centralUv = { active: false, u: centralUv.u, v: centralUv.v };
    gestureController.cancel();
    setTrackingUi("lost");
  };
}

async function startAR() {
  if (!ready || started) return;
  startButton.disabled = true;
  setStatus("Solicitando acceso a la cámara…");
  try {
    await mindarThree.start();
    started = true;
    startPanel.dataset.started = "true";
    setTrackingUi("searching");
    lastFrameTime = performance.now();
    renderer.setAnimationLoop(updateFrame);
  } catch (error) {
    startButton.disabled = false;
    setStatus("No se pudo iniciar la cámara.", error);
  }
}

function beginGesture(event) {
  if (!ready || !started || !trackingFound || event.button !== 0) return;
  event.preventDefault();
  gestureController.pointerDown(performance.now());
}

function endGesture() {
  gestureController.pointerUp(performance.now());
}

function cancelGesture() {
  gestureController.cancel();
}

async function initialize() {
  try {
    if (!window.isSecureContext) {
      throw new Error("La cámara requiere HTTPS o localhost.");
    }
    await verifyRequiredFiles();
    await initializeCompositeRenderer();
    await setupAR();
    ready = true;
    container.dataset.ready = "true";
    startButton.disabled = false;
    setStatus("Todo listo. Activá la cámara y encuadrá el print completo.");
  } catch (error) {
    console.error(error);
    setStatus("La experiencia AR todavía no está lista.", error);
  }
}

startButton.addEventListener("click", startAR);
container.addEventListener("pointerdown", beginGesture);
window.addEventListener("pointerup", endGesture);
window.addEventListener("pointercancel", cancelGesture);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelGesture();
});

initialize();
