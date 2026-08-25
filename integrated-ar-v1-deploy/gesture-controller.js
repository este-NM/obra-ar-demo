export class GestureController {
  constructor(config, interactionEngine) {
    this.config = config;
    this.interaction = interactionEngine;
    this.reset();
  }

  reset() {
    this.down = false;
    this.gestureMode = "none";
    this.context = null;
    this.downAt = 0;
    this.holdCandidateId = null;
  }

  pointerDown(now) {
    if (this.down || !Number.isFinite(now)) return false;

    if (this.interaction.mode === "idle") {
      this.down = true;
      this.gestureMode = "pending";
      this.context = "current";
      this.downAt = now;
      this.holdCandidateId = null;
      return true;
    }

    if (this.interaction.mode === "traversal" && this.interaction.activeId) {
      this.down = true;
      this.gestureMode = "pending";
      this.context = "traversal";
      this.downAt = now;
      this.holdCandidateId = this.interaction.activeId;
      return true;
    }

    return false;
  }

  update(now) {
    if (
      !this.down ||
      this.gestureMode !== "pending" ||
      !Number.isFinite(now) ||
      (now - this.downAt) / 1000 < this.config.gestures.holdDelaySeconds
    ) {
      return;
    }

    if (this.context === "current") {
      if (this.interaction.mode === "idle") {
        this.gestureMode = "implicated-hold";
      } else {
        this.gestureMode = "contact";
        this.context = null;
      }
      return;
    }

    if (this.context === "traversal") {
      const sameActiveStratum =
        this.interaction.mode === "traversal" &&
        this.interaction.activeId === this.holdCandidateId;

      // Un gesto iniciado al final de un estrato no retiene por accidente al siguiente.
      if (!sameActiveStratum) {
        this.gestureMode = this.interaction.mode === "traversal" ? "contact" : "none";
        this.context = null;
        return;
      }

      if (this.interaction.hold()) {
        this.gestureMode = "traversal-hold";
      }
    }
  }

  pointerUp(now) {
    if (!this.down) return false;

    // Resuelve primero el umbral para que una liberación posterior al límite
    // nunca pueda convertirse accidentalmente en CONTACT.
    this.update(now);

    if (this.gestureMode === "pending" && this.context === "current") {
      if (this.interaction.mode === "idle") {
        this.interaction.startTraversal();
        this.gestureMode = "contact";
      } else {
        this.gestureMode = "none";
      }
    } else if (this.gestureMode === "pending" && this.context === "traversal") {
      this.gestureMode = this.interaction.mode === "traversal" ? "contact" : "none";
    } else if (this.gestureMode === "implicated-hold") {
      this.gestureMode = "none";
    } else if (this.gestureMode === "traversal-hold") {
      if (this.interaction.holding) this.interaction.release();
      this.gestureMode = this.interaction.mode === "traversal" ? "contact" : "none";
    }

    this._clearPointerState();
    return true;
  }

  cancel() {
    if (!this.down) return false;
    if (this.gestureMode === "traversal-hold" && this.interaction.holding) {
      this.interaction.release();
    }
    this.gestureMode = this.interaction.mode === "traversal" ? "contact" : "none";
    this._clearPointerState();
    return true;
  }

  afterInteractionUpdate() {
    if (this.gestureMode === "traversal-hold" && !this.interaction.holding) {
      this.gestureMode = this.interaction.mode === "traversal" ? "contact" : "none";
      this._clearPointerState();
    } else if (this.gestureMode === "contact" && this.interaction.mode === "idle") {
      this.gestureMode = "none";
    }
  }

  snapshot() {
    return {
      gestureMode: this.gestureMode,
      down: this.down,
      context: this.context,
      holdCandidateId: this.holdCandidateId,
    };
  }

  _clearPointerState() {
    this.down = false;
    this.context = null;
    this.downAt = 0;
    this.holdCandidateId = null;
  }
}
