import type { ScenarioConfig, ScenarioId } from "./types";
import { defaultWorkflow } from "./workflow";

const common = {
  horizonDays: 120,
  warmupDays: 20,
  arrivalRatePerDay: 0.8,
  batchDays: [24, 56, 88],
  batchSize: 2,
  workflow: defaultWorkflow,
  baseRates: {
    Development: 1.1,
    Review: 0.9,
    Test: 1.05,
  },
  serviceEffort: {
    Development: { min: 0.75, max: 1.35 },
    Review: { min: 0.7, max: 1.3 },
    Test: { min: 0.65, max: 1.2 },
  },
  incident: {
    stage: "Review",
    startDay: 30,
    endDay: 44,
    ratePerDay: 0.4,
  },
};

const swarm = {
  startDay: 45,
  durationDays: 10,
  sourceStage: "Development",
  targetStage: "Review",
  capacityShift: 0.5,
  rampUpEffectiveness: 0.75,
};

export const scenarios: Record<ScenarioId, ScenarioConfig> = {
  baseline: {
    id: "baseline",
    label: "Baseline",
    summary: "Review capacity drops for 15 days, creating a visible but recoverable queue.",
    ...common,
  },
  swarm: {
    id: "swarm",
    label: "Swarm Review",
    summary: "Development lends capacity to Review for 10 days after the incident.",
    ...common,
    swarm,
  },
  wip: {
    id: "wip",
    label: "WIP Limits",
    summary: "Pull limits cap Development and Review work; constrained work remains visible upstream.",
    ...common,
    wipLimits: { Development: 6, Review: 6 },
  },
  combined: {
    id: "combined",
    label: "Combined",
    summary: "WIP limits stabilize flow while a temporary swarm clears the Review constraint.",
    ...common,
    wipLimits: { Development: 6, Review: 6 },
    swarm,
  },
};

export const scenarioList = Object.values(scenarios);
