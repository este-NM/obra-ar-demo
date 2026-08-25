export class InteractionEngine {
  constructor(config, stateEngine, onEvent = () => {}) {
    this.config = config;
    this.state = stateEngine;
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    this.mode = "idle";
    this.traversalIndex = -1;
    this.progressWithinStratum = 0;
    this.holding = false;
    this.holdElapsed = 0;
    this.manualExposureId = null;
  }

  startTraversal() {
    if (this.mode === "traversal") {
      this.onEvent({ type: "notice", message: "Traversal already active" });
      return false;
    }
    this._endCurrentExposure();
    this.mode = "traversal";
    this.traversalIndex = 0;
    this.progressWithinStratum = 0;
    this.holding = false;
    this.holdElapsed = 0;
    this.manualExposureId = null;
    this.onEvent({ type: "contact" });
    this.state.registerExposureEntry(this.activeId, "traversal");
    return true;
  }

  hold() {
    if (
      this.mode !== "traversal" ||
      !this.activeId ||
      this.activeId === this.config.canonical.current
    ) {
      this.onEvent({
        type: "notice",
        message: "HOLD requires an active non-current traversal stratum",
      });
      return false;
    }
    if (this.holding) return true;
    this.holding = true;
    this.onEvent({ type: "hold", stratum: this.activeId });
    return true;
  }

  release() {
    if (!this.holding) {
      this.onEvent({ type: "notice", message: "Nothing is currently held" });
      return false;
    }
    const stratum = this.activeId;
    this.holding = false;
    this.onEvent({ type: "release", stratum });
    return true;
  }

  startManualExposure(id) {
    if (!this.config.strata.includes(id)) return false;
    this._endCurrentExposure();
    this.mode = "manual";
    this.traversalIndex = -1;
    this.progressWithinStratum = 0;
    this.holding = false;
    this.holdElapsed = 0;
    this.manualExposureId = id;
    this.onEvent({ type: "manual-start", stratum: id });
    this.state.registerExposureEntry(id, "manual");
    return true;
  }

  stopManualExposure(reason = "manual-stop") {
    if (this.mode !== "manual") return false;
    const id = this.manualExposureId;
    this.state.endExposure(id);
    this.mode = "idle";
    this.manualExposureId = null;
    this.holdElapsed = 0;
    this.onEvent({ type: reason, stratum: id });
    return true;
  }

  update(dt, currentContext = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return;

    if (this.mode === "idle") {
      // CURRENT aporta aquí su contexto débil. StateEngine conserva una única
      // actualización estructural por frame.
      this.state.update(dt, currentContext);
      return;
    }

    const activeAtStart = this.activeId;
    const historicalHold = this.mode === "traversal" && this.holding;
    const manualHold = this.mode === "manual";
    this.state.update(dt, { exposedId: activeAtStart, held: historicalHold || manualHold });

    if (historicalHold || manualHold) {
      this.holdElapsed += dt;
      const maximum = this.getMaximumHold(activeAtStart);
      if (Number.isFinite(maximum) && this.holdElapsed >= maximum) {
        if (this.mode === "manual") {
          this.stopManualExposure("hold-limit");
        } else {
          this.holding = false;
          this.onEvent({ type: "hold-limit", stratum: activeAtStart, maximum });
        }
      }
      if (historicalHold) return;
      if (this.mode !== "traversal") return;
    }

    if (this.mode !== "traversal") return;

    this.progressWithinStratum += dt / this.config.traversal.secondsPerStratum;
    while (this.progressWithinStratum >= 1 && this.mode === "traversal") {
      this.progressWithinStratum -= 1;
      this._advanceTraversal();
    }
  }

  _advanceTraversal() {
    const leaving = this.activeId;
    this.state.endExposure(leaving);
    this.traversalIndex += 1;
    this.holdElapsed = 0;
    this.holding = false;

    const currentIndex = this.config.strata.indexOf(this.config.canonical.current);
    if (this.traversalIndex >= currentIndex) {
      this.traversalIndex = currentIndex;
      const current = this.config.canonical.current;
      this.state.registerExposureEntry(current, "traversal-arrival");
      this.state.endExposure(current);
      this.onEvent({ type: "traversal-complete", stratum: current });
      this.mode = "idle";
      this.traversalIndex = -1;
      this.progressWithinStratum = 0;
      return;
    }

    this.state.registerExposureEntry(this.activeId, "traversal");
  }

  _endCurrentExposure() {
    if (this.activeId) this.state.endExposure(this.activeId);
  }

  getMaximumHold(id) {
    return this.state.getMaximumHold(id);
  }

  get activeId() {
    if (this.mode === "manual") return this.manualExposureId;
    if (this.mode !== "traversal" || this.traversalIndex < 0) return null;
    return this.config.strata[this.traversalIndex];
  }

  snapshot() {
    const activeId = this.activeId;
    const maximumHold = activeId ? this.getMaximumHold(activeId) : null;
    return {
      mode: this.mode,
      activeId,
      holding: this.holding,
      progressWithinStratum: this.progressWithinStratum,
      holdElapsed: this.holdElapsed,
      maximumHold,
    };
  }
}
