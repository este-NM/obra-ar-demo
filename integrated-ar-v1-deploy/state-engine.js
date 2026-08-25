const ROLE = Object.freeze({
  CURRENT: "CURRENT",
  IMPLICATED: "IMPLICATED",
  HISTORY: "HISTORY",
});

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

export class StateEngine {
  constructor(config, onEvent = () => {}) {
    this.config = config;
    this.onEvent = onEvent;
    this._validateCanonicalConfiguration();
    this.reset();
  }

  _validateCanonicalConfiguration() {
    const { current, implicated } = this.config.canonical;
    if (!this.config.strata.includes(current) || !this.config.strata.includes(implicated)) {
      throw new Error("Canonical current and implicated must exist in config.strata");
    }
    if (current === implicated) {
      throw new Error("Canonical current and implicated must be different strata");
    }
  }

  reset() {
    this.current = this.config.canonical.current;
    this.implicated = this.config.canonical.implicated;
    this.memory = { ...this.config.memory.initial };
    this.recurrence = Object.fromEntries(this.config.strata.map((id) => [id, 0]));
    this.exposureSeconds = Object.fromEntries(this.config.strata.map((id) => [id, 0]));
    this.phase = Object.fromEntries(this.config.strata.map((id) => [id, 0]));
    this._lastExposed = null;
    this._memoryLogBucket = Object.fromEntries(this.config.strata.map((id) => [id, 0]));
  }

  getRole(id) {
    if (id === this.current) return ROLE.CURRENT;
    if (id === this.implicated) return ROLE.IMPLICATED;
    return ROLE.HISTORY;
  }

  registerExposureEntry(id, source = "traversal") {
    if (!this.config.strata.includes(id)) return;
    this.recurrence[id] += 1;
    this.memory[id] = clamp(
      this.memory[id] + this.getEffectiveMemoryGains(id).recurrence,
      0,
      this.config.memory.maximum,
    );
    this._lastExposed = id;
    this.onEvent({ type: "entered", stratum: id, source, recurrence: this.recurrence[id] });
  }

  endExposure(id) {
    if (this._lastExposed === id) this._lastExposed = null;
  }

  update(
    dt,
    { exposedId = null, held = false, microExposure = null, phaseIds = [] } = {},
  ) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    const validMicroExposure =
      !exposedId &&
      this.config.strata.includes(microExposure?.id) &&
      Number.isFinite(microExposure?.gainFactor) &&
      microExposure.gainFactor > 0
        ? microExposure
        : null;
    const memoryExposureId = exposedId ?? validMicroExposure?.id ?? null;
    const phaseOnlyIds = new Set(
      Array.isArray(phaseIds) ? phaseIds.filter((id) => this.config.strata.includes(id)) : [],
    );

    for (const id of this.config.strata) {
      if (id === memoryExposureId) {
        const gains = this.getEffectiveMemoryGains(id);
        const exposureGainFactor = exposedId ? 1 : validMicroExposure.gainFactor;
        const holdGain = exposedId && held ? gains.hold : 0;
        this.memory[id] = clamp(
          this.memory[id] + (gains.exposure * exposureGainFactor + holdGain) * dt,
          0,
          this.config.memory.maximum,
        );
        this.exposureSeconds[id] += dt * exposureGainFactor;
        this._logMemoryMilestones(id);
      } else {
        this.memory[id] = clamp(
          this.memory[id] - this.config.memory.decayPerSecond * dt,
          0,
          this.config.memory.maximum,
        );
        this._memoryLogBucket[id] = Math.floor(this.memory[id] * 10 + 1e-9);

      }

      // Fase, memoria, exposure y decay comparten esta única integración.
      // phaseIds mantiene activos los layers visuales sin otra llamada a update().
      const phaseFactor =
        id === exposedId || phaseOnlyIds.has(id)
          ? 1
          : !exposedId
            ? id === this.current
              ? this.config.internalDynamics.currentIdleFactor
              : id === this.implicated
                ? this.config.internalDynamics.implicatedIdleFactor
                : 0
            : 0;
      this.phase[id] =
        (this.phase[id] + this.config.internalDynamics.cyclesPerSecond[id] * phaseFactor * dt) %
        1;
    }

    if (
      memoryExposureId &&
      this.getRole(memoryExposureId) === ROLE.HISTORY &&
      memoryExposureId !== this.config.canonical.implicated &&
      this.memory[memoryExposureId] >= this.config.memory.promotionThreshold
    ) {
      this._promote(memoryExposureId);
    }

    if (
      this.implicated !== this.config.canonical.implicated &&
      this.memory[this.implicated] < this.config.memory.demotionThreshold
    ) {
      this._demoteToCanonicalImplicated();
    }
  }

  advancePhaseOnly(id, dt) {
    if (!this.config.strata.includes(id) || !Number.isFinite(dt) || dt <= 0) return false;
    this.phase[id] =
      (this.phase[id] + this.config.internalDynamics.cyclesPerSecond[id] * dt) % 1;
    return true;
  }

  _logMemoryMilestones(id) {
    const nextBucket = Math.floor(this.memory[id] * 10 + 1e-9);
    if (nextBucket > this._memoryLogBucket[id]) {
      this._memoryLogBucket[id] = nextBucket;
      this.onEvent({ type: "memory", stratum: id, value: this.memory[id] });
    }
  }

  _promote(id) {
    const previous = this.implicated;
    this.implicated = id;
    this.onEvent({ type: "promoted", stratum: id, displaced: previous });
  }

  _demoteToCanonicalImplicated() {
    const demoted = this.implicated;
    this.implicated = this.config.canonical.implicated;
    this.onEvent({
      type: "demoted",
      stratum: demoted,
      restored: this.config.canonical.implicated,
    });
  }

  getOperationalDistance(id) {
    const currentIndex = this.config.strata.indexOf(this.current);
    const stratumIndex = this.config.strata.indexOf(id);
    if (stratumIndex < 0) return null;
    return Math.abs(currentIndex - stratumIndex);
  }

  getDistanceGainFactor(id) {
    const distance = this.getOperationalDistance(id);
    if (distance === null) return 0;
    return 1 / (1 + this.config.memory.distanceGainFactor * distance);
  }

  getAppliedGainFactor(id) {
    const isDistanceScaledHistory =
      this.getRole(id) === ROLE.HISTORY && id !== this.config.canonical.implicated;
    return isDistanceScaledHistory ? this.getDistanceGainFactor(id) : 1;
  }

  getEffectiveMemoryGains(id) {
    const factor = this.getAppliedGainFactor(id);
    return {
      factor,
      exposure: this.config.memory.exposureGainPerSecond * factor,
      hold: this.config.memory.holdGainPerSecond * factor,
      recurrence: this.config.memory.recurrenceGain * factor,
    };
  }

  getMaximumHold(id) {
    if (
      !id ||
      id === this.config.canonical.current ||
      id === this.config.canonical.implicated
    ) {
      return Infinity;
    }
    const distance = this.getOperationalDistance(id);
    return this.config.hold.baseSeconds / (1 + this.config.hold.distanceFactor * distance);
  }

  getWeight(id, activeId = null) {
    if (id === this.current) return this.config.weights.initial[id];
    if (id === activeId) return this.config.weights.traversal;
    if (id === this.implicated) return this.config.weights.implicated;
    if (
      id === this.config.canonical.implicated &&
      this.implicated !== this.config.canonical.implicated
    ) {
      return this.config.weights.displacedCanonicalHistory;
    }
    return this.config.weights.initial[id];
  }

  snapshot(activeId = null) {
    return {
      current: this.current,
      implicated: this.implicated,
      strata: this.config.strata.map((id) => ({
        ...this._diagnosticsFor(id),
        id,
        role: this.getRole(id),
        weight: this.getWeight(id, activeId),
        memory: this.memory[id],
        recurrence: this.recurrence[id],
        exposureSeconds: this.exposureSeconds[id],
        phase: this.phase[id],
        active: id === activeId,
      })),
    };
  }

  _diagnosticsFor(id) {
    const gains = this.getEffectiveMemoryGains(id);
    return {
      operationalDistance: this.getOperationalDistance(id),
      distanceGainFactor: this.getDistanceGainFactor(id),
      appliedGainFactor: gains.factor,
      effectiveExposureGain: gains.exposure,
      effectiveHoldGain: gains.hold,
      effectiveRecurrenceGain: gains.recurrence,
      maximumHold: this.getMaximumHold(id),
    };
  }
}

export { ROLE };
