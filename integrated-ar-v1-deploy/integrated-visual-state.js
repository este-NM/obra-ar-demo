export function deriveIntegratedVisualState(
  config,
  stateSnapshot,
  interactionSnapshot,
  projectionSnapshot,
  gestureSnapshot = { gestureMode: "none" },
  currentDynamicsSnapshot = null,
) {
  const phases = Object.fromEntries(stateSnapshot.strata.map((stratum) => [stratum.id, stratum.phase]));
  const activeTraversalId = interactionSnapshot.activeId;
  const traversalOwnsVisual = interactionSnapshot.mode === "traversal" && activeTraversalId;
  const implicatedHoldOwnsVisual = Boolean(
    !traversalOwnsVisual &&
      interactionSnapshot.mode === "idle" &&
      gestureSnapshot.gestureMode === "implicated-hold" &&
      stateSnapshot.implicated,
  );
  const primaryId = traversalOwnsVisual
    ? activeTraversalId
    : implicatedHoldOwnsVisual
      ? stateSnapshot.implicated
      : stateSnapshot.current;
  const effectiveLayers = [...projectionSnapshot.effectiveLayers];
  const automaticCurrentOwnsVisual = Boolean(
    !traversalOwnsVisual &&
      !implicatedHoldOwnsVisual &&
      interactionSnapshot.mode === "idle" &&
      currentDynamicsSnapshot &&
      !currentDynamicsSnapshot.suspended,
  );
  const latentOwnsVisual =
    automaticCurrentOwnsVisual && currentDynamicsSnapshot.submode === "LATENT";
  const kineticOwnsVisual =
    automaticCurrentOwnsVisual && currentDynamicsSnapshot.submode === "KINETIC";
  const automaticSourceId = latentOwnsVisual
    ? currentDynamicsSnapshot.latentSourceId
    : kineticOwnsVisual
      ? currentDynamicsSnapshot.kineticCarrySourceId
      : null;
  const automaticExpression = latentOwnsVisual
    ? currentDynamicsSnapshot.latentEffectiveExpression
    : kineticOwnsVisual
      ? currentDynamicsSnapshot.kineticCarryExpression
      : null;
  const automaticLayers = latentOwnsVisual
    ? [...currentDynamicsSnapshot.latentLayers]
    : kineticOwnsVisual
      ? [...currentDynamicsSnapshot.kineticCarryLayers]
      : [];
  const presenceLayers = traversalOwnsVisual || implicatedHoldOwnsVisual
    ? []
    : automaticCurrentOwnsVisual
      ? [...automaticLayers]
      : [...effectiveLayers];
  const presenceOpacity = latentOwnsVisual
    ? config.visualIntegration.relationOutputLayerOpacity *
      currentDynamicsSnapshot.presenceValue
    : kineticOwnsVisual
      ? config.currentDynamics.kinetic.carryOpacity *
        currentDynamicsSnapshot.kineticCarryPulse
      : config.visualIntegration.relationOutputLayerOpacity;
  const displayMode = implicatedHoldOwnsVisual
    ? "implicated-hold"
    : gestureSnapshot.gestureMode === "traversal-hold"
      ? "traversal-hold"
      : interactionSnapshot.mode;

  return {
    primaryId,
    primaryPhase: phases[primaryId] ?? 0,
    currentVisible: primaryId === config.canonical.current,
    currentCentralityVisible:
      primaryId === config.canonical.current &&
      (!automaticCurrentOwnsVisual || kineticOwnsVisual),
    activeTraversalId,
    presenceLayers,
    presenceOpacity,
    presencePhases: Object.fromEntries(
      presenceLayers.map((id) => [id, phases[id] ?? 0]),
    ),
    visibleExpression: traversalOwnsVisual
      ? [activeTraversalId]
      : implicatedHoldOwnsVisual
        ? [stateSnapshot.implicated]
        : [stateSnapshot.current, ...presenceLayers],
    displayMode,
    gestureMode: gestureSnapshot.gestureMode,
    implicatedHoldOwnsVisual,
    operationalRelation: projectionSnapshot.operationalRelation,
    effectiveExpression: projectionSnapshot.effectiveExpression,
    effectiveLayers,
    currentSubmode: currentDynamicsSnapshot?.submode ?? null,
    automaticCurrentOwnsVisual,
    automaticSourceId,
    automaticExpression,
    automaticLayers,
    relationPersistsBehindTraversal: Boolean(
      traversalOwnsVisual && stateSnapshot.implicated !== config.canonical.implicated,
    ),
  };
}
