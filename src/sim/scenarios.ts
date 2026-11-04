import type { ScenarioConfig, ScenarioId } from "./types";
import { defaultWorkflow } from "./workflow";

const common = {
  horizonDays: 120,
  warmupDays: 20,
  arrivalRatePerDay: 1.6,
  initialBacklog: { pbiCount: 0, bugCount: 0 },
  featureBacklog: { featureCount: 0, minPbisPerFeature: 5, maxPbisPerFeature: 10, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 },
  batchDays: [],
  batchSize: 0,
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
    Development: { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
    Test: { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
  },
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
    label: "Start Finishing - Stop Starting",
    summary: "Finish the oldest incomplete Feature before admitting another, using unused Development capacity to help Test.",
    ...common,
    featureFocus: { startDay: 0 },
  },
  wip: {
    id: "wip",
    label: "WIP Limits",
    summary: "Pull limits cap Development and Test work; constrained work remains visible upstream.",
    ...common,
    wipLimits: { Development: 5, Integration: 5, Test: 5 },
  },
  combined: {
    id: "combined",
    label: "WIP Limits + Start Finishing",
    summary: "Stage WIP limits stabilize pull flow while finishing focus completes one Feature before starting the next.",
    ...common,
    wipLimits: { Development: 5, Integration: 5, Test: 5 },
    featureFocus: { startDay: 0 },
  },
  ranking: {
    id: "ranking",
    label: "Order backlog by ranking",
    summary: "Feature 001 ranks first, so its PBIs and feedback Bugs are admitted from Backlog before lower-ranked Feature work.",
    ...common,
    backlogRanking: true,
  },
};

export const scenarioList = Object.values(scenarios);
