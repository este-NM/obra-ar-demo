import { resolveRelationOutput } from "./projection-engine.js";

const TAU = Math.PI * 2;
const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));
const wrap01 = (value) => ((value % 1) + 1) % 1;
const oscillator01 = (phase) => 0.5 + 0.5 * Math.cos(TAU * phase);

export class CurrentDynamicsEngine {
  constructor(config) {
    this.config = config;
    this.currentId = config.canonical.current;
    const relationPrefix = `${this.currentId}/`;
    this.candidates = Object.keys(config.relationOutputs)
      .filter((relation) => relation.startsWith(relationPrefix))
      .map((relation) => relation.slice(relationPrefix.length))
      .filter((id) => id !== this.currentId && config.strata.includes(id));

    if (this.candidates.length === 0) {
      throw new Error("CURRENT LATENT requires at least one configured relation output");
    }
    for (const id of this.candidates) {
      const weight = config.currentDynamics.latent.baseWeights[id];
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`Missing or invalid latent base weight for ${id}`);
      }
    }
    this.reset();
  }

  reset() {
    this.submode = "LATENT";
    this.suspended = false;
    this.rawSpeed = 0;
    this.filteredSpeed = 0;
    this.onSustainElapsed = 0;
    this.offSustainElapsed = 0;
    this.previousPointer = null;
    this.latentSlotElapsed = 0;
    this.latentSwitchCount = 0;
    this.presencePhase = 0;
    this.kineticCarryPhase = 0;
    this.schedulerScores = Object.fromEntries(this.candidates.map((id) => [id, 0]));
    this.latentSelectionCounts = Object.fromEntries(this.candidates.map((id) => [id, 0]));
    this.latentWeights = this._computeWeights(null);
    this.latentSourceId = null;
    this.latentOutput = null;
    this.kineticCarrySourceId = null;
    this.kineticCarryOutput = null;
    // La primera selección también pasa por smooth weighted round-robin para
    // que RESET restaure exactamente scores y secuencia.
    this._scheduleNext(null);
  }

  update(
    dt,
    { automaticEnabled = true, pointer = null, stateSnapshot = null } = {},
  ) {
    if (!Number.isFinite(dt) || dt <= 0) return this.snapshot();

    this.suspended = !automaticEnabled;
    this._sampleMotion(pointer, dt, automaticEnabled);
    if (!automaticEnabled) return this.snapshot();

    if (this.submode === "LATENT") {
      this.latentSlotElapsed += dt;
      this.presencePhase = wrap01(
        this.presencePhase + this.config.currentDynamics.presence.hz * dt,
      );
      const switchInterval = 1 / this.config.currentDynamics.latent.switchHz;
      while (this.latentSlotElapsed + 1e-12 >= switchInterval) {
        this.latentSlotElapsed -= switchInterval;
        this._scheduleNext(stateSnapshot);
        this.latentSwitchCount += 1;
      }

      if (
        this.filteredSpeed >= this.config.currentDynamics.motion.kineticOnThreshold &&
        this.rawSpeed >= this.config.currentDynamics.motion.kineticOffThreshold
      ) {
        this.onSustainElapsed += dt;
      } else {
        this.onSustainElapsed = 0;
      }

      if (this.onSustainElapsed >= this.config.currentDynamics.motion.onSustainSeconds) {
        this._enterKinetic();
      }
    } else {
      this.kineticCarryPhase = wrap01(
        this.kineticCarryPhase + this.config.currentDynamics.kinetic.carryHz * dt,
      );
      if (this.filteredSpeed <= this.config.currentDynamics.motion.kineticOffThreshold) {
        this.offSustainElapsed += dt;
      } else {
        this.offSustainElapsed = 0;
      }

      if (this.offSustainElapsed >= this.config.currentDynamics.motion.offSustainSeconds) {
        this._enterLatent();
      }
    }

    this.latentWeights = this._computeWeights(stateSnapshot);
    return this.snapshot();
  }

  getStructuralContext() {
    if (this.suspended) return { phaseIds: [] };

    if (this.submode === "LATENT") {
      return {
        microExposure: {
          id: this.latentSourceId,
          gainFactor:
            this.config.currentDynamics.latent.exposureGainFactor * this.presenceValue,
        },
        phaseIds: [...new Set([this.latentSourceId, ...this.latentOutput.layers])],
      };
    }

    if (!this.kineticCarrySourceId || !this.kineticCarryOutput) {
      return { phaseIds: [] };
    }
    return {
      microExposure: {
        id: this.kineticCarrySourceId,
        gainFactor:
          this.config.currentDynamics.kinetic.carryExposureGainFactor *
          this.kineticCarryPulse,
      },
      phaseIds: [
        ...new Set([this.kineticCarrySourceId, ...this.kineticCarryOutput.layers]),
      ],
    };
  }

  get presenceValue() {
    const { minOpacity, maxOpacity } = this.config.currentDynamics.presence;
    return minOpacity + (maxOpacity - minOpacity) * oscillator01(this.presencePhase);
  }

  get kineticCarryPulse() {
    return oscillator01(this.kineticCarryPhase);
  }

  snapshot() {
    return {
      submode: this.submode,
      suspended: this.suspended,
      rawSpeed: this.rawSpeed,
      filteredSpeed: this.filteredSpeed,
      onSustainElapsed: this.onSustainElapsed,
      offSustainElapsed: this.offSustainElapsed,
      latentSourceId: this.latentSourceId,
      latentOperationalRelation: this.latentOutput.operationalRelation,
      latentEffectiveExpression: this.latentOutput.name,
      latentLayers: [...this.latentOutput.layers],
      latentWeights: { ...this.latentWeights },
      latentSwitchCount: this.latentSwitchCount,
      latentSelectionCounts: { ...this.latentSelectionCounts },
      latentSlotElapsed: this.latentSlotElapsed,
      kineticCarrySourceId: this.kineticCarrySourceId,
      kineticCarryExpression: this.kineticCarryOutput?.name ?? null,
      kineticCarryLayers: [...(this.kineticCarryOutput?.layers ?? [])],
      presencePhase: this.presencePhase,
      presenceValue: this.presenceValue,
      kineticCarryPhase: this.kineticCarryPhase,
      kineticCarryPulse: this.kineticCarryPulse,
    };
  }

  _sampleMotion(pointer, dt, updateFilter) {
    const active = Boolean(
      pointer?.active && Number.isFinite(pointer.u) && Number.isFinite(pointer.v),
    );
    const nextPointer = active
      ? { active: true, u: pointer.u, v: pointer.v }
      : { active: false, u: pointer?.u ?? 0.5, v: pointer?.v ?? 0.5 };
    this.rawSpeed =
      active && this.previousPointer?.active
        ? Math.hypot(
            nextPointer.u - this.previousPointer.u,
            nextPointer.v - this.previousPointer.v,
          ) / dt
        : 0;
    this.previousPointer = nextPointer;

    if (!updateFilter) return;
    const smoothingSeconds = this.config.currentDynamics.motion.velocitySmoothing;
    const alpha = smoothingSeconds > 0 ? 1 - Math.exp(-dt / smoothingSeconds) : 1;
    this.filteredSpeed += alpha * (this.rawSpeed - this.filteredSpeed);
  }

  _computeWeights(stateSnapshot) {
    const memories = Object.fromEntries(
      (stateSnapshot?.strata ?? []).map((stratum) => [stratum.id, stratum.memory]),
    );
    const maximum = this.config.memory.maximum;
    const memoryBias = this.config.currentDynamics.latent.memoryBias;
    return Object.fromEntries(
      this.candidates.map((id) => {
        const normalizedMemory = clamp((memories[id] ?? 0) / maximum, 0, 1);
        return [
          id,
          this.config.currentDynamics.latent.baseWeights[id] +
            memoryBias * normalizedMemory,
        ];
      }),
    );
  }

  _scheduleNext(stateSnapshot) {
    const weights = this._computeWeights(stateSnapshot);
    const totalWeight = this.candidates.reduce((total, id) => total + weights[id], 0);
    let selectedId = this.candidates[0];
    let selectedScore = -Infinity;

    for (const id of this.candidates) {
      this.schedulerScores[id] += weights[id];
      if (this.schedulerScores[id] > selectedScore) {
        selectedId = id;
        selectedScore = this.schedulerScores[id];
      }
    }

    this.schedulerScores[selectedId] -= totalWeight;
    this.latentSourceId = selectedId;
    this.latentOutput = resolveRelationOutput(this.config, this.currentId, selectedId);
    this.latentSelectionCounts[selectedId] += 1;
    this.latentWeights = weights;
  }

  _enterKinetic() {
    this.submode = "KINETIC";
    this.kineticCarrySourceId = this.latentSourceId;
    this.kineticCarryOutput = {
      ...this.latentOutput,
      layers: [...this.latentOutput.layers],
    };
    this.kineticCarryPhase = 0;
    this.onSustainElapsed = 0;
    this.offSustainElapsed = 0;
  }

  _enterLatent() {
    this.submode = "LATENT";
    this.kineticCarrySourceId = null;
    this.kineticCarryOutput = null;
    this.kineticCarryPhase = 0;
    this.onSustainElapsed = 0;
    this.offSustainElapsed = 0;
  }
}
