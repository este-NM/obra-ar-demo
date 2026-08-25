const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

export function resolveRelationOutput(config, currentId, sourceId) {
  const operationalRelation = `${currentId}/${sourceId}`;
  const configuredOutput = config.relationOutputs?.[operationalRelation];
  if (
    !configuredOutput ||
    typeof configuredOutput.name !== "string" ||
    !Array.isArray(configuredOutput.layers)
  ) {
    throw new Error(`Missing or invalid relation output for ${operationalRelation}`);
  }
  return {
    operationalRelation,
    name: configuredOutput.name,
    layers: [...configuredOutput.layers],
  };
}

export class ProjectionEngine {
  constructor(config) {
    this.config = config;
  }

  project(stateSnapshot) {
    const relationOutput = resolveRelationOutput(
      this.config,
      stateSnapshot.current,
      stateSnapshot.implicated,
    );
    const effectiveExpression = relationOutput.name;
    const effectiveLayers = [...relationOutput.layers];

    const currentParameters = { ...this.config.projection.baseCurrentParameters };
    for (const stratum of stateSnapshot.strata) {
      const influence = this.config.projection.memoryInfluence[stratum.id];
      for (const parameter of Object.keys(currentParameters)) {
        currentParameters[parameter] += stratum.memory * (influence?.[parameter] ?? 0);
      }
    }
    for (const parameter of Object.keys(currentParameters)) {
      currentParameters[parameter] = clamp(
        currentParameters[parameter],
        this.config.projection.parameterMinimum,
        this.config.projection.parameterMaximum,
      );
    }

    return {
      operationalRelation: relationOutput.operationalRelation,
      relationSource: "CURRENT/IMPLICATED",
      effectiveExpression,
      effectiveLayers,
      relationOutput: {
        name: effectiveExpression,
        layers: [...effectiveLayers],
      },
      currentParameters,
    };
  }
}
