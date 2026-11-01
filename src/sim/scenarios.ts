import type { ScenarioConfig, ScenarioId } from "./types";
import { defaultWorkflow } from "./workflow";

const common = {
  horizonDays: 120,
  warmupDays: 20,
  arrivalRatePerDay: 1.6,
  batchDays: [24, 56, 88],
  batchSize: 2,
  workflow: defaultWorkflow,
  wipAssistanceEffectiveness: 0.75,
  baseRates: {
    Development: 1.4,
    Test: 0.7,
  },
  serviceEffort: {
    Development: { min: 0.75, max: 1.35 },
    Test: { min: 0.65, max: 1.2 },
  },
  operatingAssumptions: {
    Development: { focusWip: 2, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
    Test: { focusWip: 2, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
  },
};

const swarm = {
  startDay: 45,
  durationDays: 10,
  sourceStage: "Development",
  targetStage: "Test",
  capacityShift: 0.5,
  rampUpEffectiveness: 0.75,
};

export const scenarios: Record<ScenarioId, ScenarioConfig> = {
  baseline: {
    id: "baseline",
    label: "Baseline",
    summary: "Test is the deliberately slower stage, so work accumulates there without an incident.",
    ...common,
  },
  swarm: {
    id: "swarm",
    label: "Swarm Test",
    summary: "Development lends capacity to Test for 10 days to relieve the bottleneck.",
    ...common,
    swarm,
  },
  wip: {
    id: "wip",
    label: "WIP Limits",
    summary: "Pull limits cap Development and Test work; constrained work remains visible upstream.",
    ...common,
    wipLimits: { Development: 6, Test: 6 },
  },
  combined: {
    id: "combined",
    label: "Combined",
    summary: "WIP limits stabilize flow while a temporary swarm helps the Test constraint.",
    ...common,
    wipLimits: { Development: 6, Test: 6 },
    swarm,
  },
};

export const scenarioList = Object.values(scenarios);
