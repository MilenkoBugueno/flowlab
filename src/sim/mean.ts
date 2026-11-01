import { runScenario } from "./engine";
import type { DailySnapshot, MeanSimulationResult, Metrics, ScenarioConfig, Stage } from "./types";
import { activeStages } from "./workflow";

export function validateMeanSeedCount(seedCount: number): number {
  if (!Number.isInteger(seedCount) || seedCount <= 0) throw new Error("The mean CFD seed count must be a positive whole number.");
  return seedCount;
}

export function seedsForMean(seedCount: number, firstSeed = 1): number[] {
  validateMeanSeedCount(seedCount);
  if (!Number.isInteger(firstSeed) || firstSeed < 0) throw new Error("The first seed must be a non-negative whole number.");
  return Array.from({ length: seedCount }, (_, index) => firstSeed + index);
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function meanStates(snapshots: DailySnapshot[], stages: Stage[], field: "states" | "waiting"): Record<Stage, number> {
  return Object.fromEntries(stages.map((stage) => [stage, mean(snapshots.map((snapshot) => snapshot[field][stage]))]));
}

function meanActive(snapshots: DailySnapshot[], stages: Stage[]): Record<Stage, number> {
  return Object.fromEntries(stages.map((stage) => [stage, mean(snapshots.map((snapshot) => snapshot.active[stage] ?? 0))]));
}

function meanMetrics(runs: ReturnType<typeof runScenario>[]): Metrics {
  const averageMetric = (key: keyof Metrics): number | null => {
    const values = runs.map((run) => run.metrics[key]).filter((value): value is number => value !== null);
    return values.length ? mean(values) : null;
  };
  return {
    completedItems: averageMetric("completedItems") ?? 0,
    throughputPerWeek: averageMetric("throughputPerWeek") ?? 0,
    medianCycleTime: averageMetric("medianCycleTime"),
    p85CycleTime: averageMetric("p85CycleTime"),
    maxReviewWip: averageMetric("maxReviewWip") ?? 0,
    reviewQueueDays: averageMetric("reviewQueueDays") ?? 0,
    totalQueueDays: averageMetric("totalQueueDays") ?? 0,
    meanWip: averageMetric("meanWip") ?? 0,
    totalTaskSwitchingLoss: averageMetric("totalTaskSwitchingLoss") ?? 0,
    littlesLawEstimate: averageMetric("littlesLawEstimate"),
  };
}

export function runMeanScenario(config: ScenarioConfig, seedCount: number, firstSeed = 1): MeanSimulationResult {
  const seeds = seedsForMean(seedCount, firstSeed);
  const runs = seeds.map((seed) => runScenario(config, seed));
  const stages = config.workflow.stages;
  const active = activeStages(config.workflow);
  const snapshots = Array.from({ length: config.horizonDays }, (_, day) => {
    const dailyRuns = runs.map((run) => run.snapshots[day]);
    return {
      day,
      states: meanStates(dailyRuns, stages, "states"),
      active: meanActive(dailyRuns, active),
      waiting: meanStates(dailyRuns, stages, "waiting"),
      arrivals: mean(dailyRuns.map((snapshot) => snapshot.arrivals)),
      completions: mean(dailyRuns.map((snapshot) => snapshot.completions)),
      externalBacklog: mean(dailyRuns.map((snapshot) => snapshot.externalBacklog)),
    };
  });
  return { config, seeds, runs, snapshots, metrics: meanMetrics(runs) };
}
