import { visualConfig } from "./visual-config.js";

// Configuración estructural de la obra integrada. Los motores consumen estos
// datos y no contienen nombres específicos de estratos.
export const CONFIG = {
  strata: ["s1", "s2", "s3", "ent1", "ent2", "CURRENT"],

  canonical: {
    current: "CURRENT",
    implicated: "ent2",
  },

  weights: {
    initial: {
      s1: 0.25,
      s2: 0.45,
      s3: 0.7,
      ent1: 0.85,
      ent2: 1.0,
      CURRENT: 5.437,
    },
    traversal: 3.0,
    implicated: 1.0,
    displacedCanonicalHistory: 0.85,
  },

  traversal: {
    // Duración provisional de cada estrato histórico. CURRENT sólo marca llegada.
    secondsPerStratum: 1.5,
  },

  hold: {
    baseSeconds: 12,
    distanceFactor: 0.35,
  },

  memory: {
    initial: { s1: 0, s2: 0, s3: 0, ent1: 0, ent2: 0, CURRENT: 0 },
    exposureGainPerSecond: 0.18,
    holdGainPerSecond: 0.12,
    recurrenceGain: 0.12,
    decayPerSecond: 0.018,
    maximum: 2.5,
    promotionThreshold: 1.0,
    demotionThreshold: 0.7,
    distanceGainFactor: 0.25,
  },

  internalDynamics: {
    // La fase estructural usa la misma frecuencia ya aprobada en visual-config.js.
    cyclesPerSecond: {
      s1: visualConfig.s1.frequency,
      s2: visualConfig.s2.frequency,
      s3: visualConfig.s3.frequency,
      ent1: visualConfig.ent1.frequency,
      ent2: visualConfig.ent2.frequency,
      CURRENT: 0.94,
    },
    currentIdleFactor: 1.0,
    implicatedIdleFactor: 0.0,
  },

  // Correspondencias provisionales para probar la arquitectura relacional.
  // Cambiar estos outputs no altera estado, interacción ni promoción.
  relationOutputs: {
    "CURRENT/ent2": { layers: [], name: "basal" },
    "CURRENT/s1": { layers: ["s2"], name: "expression-A" },
    "CURRENT/s2": { layers: ["s3"], name: "expression-B" },
    "CURRENT/s3": { layers: ["s1"], name: "expression-C" },
    "CURRENT/ent1": { layers: ["ent2"], name: "expression-D" },
  },

  currentDynamics: {
    latent: {
      switchHz: 6,
      memoryBias: 4,
      exposureGainFactor: 0.1,
      baseWeights: {
        s1: 1,
        s2: 1,
        s3: 1,
        ent1: 1,
        ent2: 1,
      },
    },
    motion: {
      // Velocidad en unidades UV por segundo, filtrada con una EMA.
      kineticOnThreshold: 0.18,
      kineticOffThreshold: 0.065,
      onSustainSeconds: 0.22,
      offSustainSeconds: 0.34,
      // Constante temporal de la EMA, expresada en segundos.
      velocitySmoothing: 0.12,
    },
    kinetic: {
      carryHz: 3,
      carryOpacity: 0.42,
      carryExposureGainFactor: 0.08,
    },
    presence: {
      hz: 8,
      minOpacity: 0.28,
      maxOpacity: 1,
    },
  },

  projection: {
    baseCurrentParameters: {
      glow: 0.4,
      persistence: 0.62,
      flickerDepth: 0.18,
      vibration: 0.12,
    },
    memoryInfluence: {
      s1: { glow: 0.01, persistence: 0.02, flickerDepth: 0.02, vibration: 0.1 },
      s2: { glow: 0.09, persistence: 0.03, flickerDepth: 0.05, vibration: 0.03 },
      s3: { glow: 0.04, persistence: 0.08, flickerDepth: 0.02, vibration: 0.02 },
      ent1: { glow: 0.03, persistence: 0.04, flickerDepth: 0.06, vibration: 0.01 },
      ent2: {},
      CURRENT: { glow: 0.04, persistence: 0.02, flickerDepth: 0.01, vibration: 0.01 },
    },
    parameterMinimum: 0,
    parameterMaximum: 1,
  },

  visualIntegration: {
    // Presencia moderada de los layers producidos por la relación durante CURRENT idle.
    relationOutputLayerOpacity: 0.32,
  },

  gestures: {
    // Un pointerdown durante traversal se convierte en HOLD después de este umbral.
    holdDelaySeconds: 0.18,
  },
};
