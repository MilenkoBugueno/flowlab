import { describe, expect, it } from "vitest";
import { calculateMetrics, effectiveCapacityFor, runScenario } from "./engine";
import { runMeanScenario, validateMeanSeedCount } from "./mean";
import { scenarios } from "./scenarios";
import { validateOperatingAssumptions, validateWipAssistanceEffectiveness } from "./settings";
import { withWorkflow } from "./workflow";

describe("FlowLab simulation engine", () => {
  it("uses the Test bottleneck workflow by default", () => {
    expect(scenarios.baseline.workflow.stages).toEqual(["Backlog", "Development", "Test", "Done"]);
    expect(scenarios.baseline.arrivalRatePerDay).toBe(1.6);
    expect(scenarios.baseline.baseRates).toEqual({ Development: 1.4, Test: 0.7 });
    expect(scenarios.baseline.operatingAssumptions).toEqual({
      Development: { focusWip: 2, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
      Test: { focusWip: 2, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
    });
    expect(scenarios.baseline.incident).toBeUndefined();
    expect(scenarios.swarm.swarm).toMatchObject({ sourceStage: "Development", targetStage: "Test" });
  });

  it("is deterministic for a fixed seed", () => {
    expect(runScenario(scenarios.baseline, 42).snapshots).toEqual(runScenario(scenarios.baseline, 42).snapshots);
  });

  it("conserves every item in every snapshot", () => {
    const result = runScenario(scenarios.combined, 42);
    let arrivals = 0;
    for (const snapshot of result.snapshots) {
      arrivals += snapshot.arrivals;
      expect(Object.values(snapshot.states).reduce((total, count) => total + count, 0) + snapshot.externalBacklog).toBe(arrivals);
    }
  });

  it("honours the Test WIP limit", () => {
    const result = runScenario(scenarios.wip, 42);
    expect(Math.max(...result.snapshots.map((snapshot) => snapshot.states.Test))).toBeLessThanOrEqual(6);
  });

  it("reduces Test queue-days with a scheduled swarm for the default seed", () => {
    const baseline = runScenario(scenarios.baseline, 42);
    const swarm = runScenario(scenarios.swarm, 42);
    expect(swarm.metrics.reviewQueueDays).toBeLessThan(baseline.metrics.reviewQueueDays);
  });

  it("records daily movements that reconcile with the CFD states", () => {
    const result = runScenario(scenarios.baseline, 42);
    expect(result.dailyLog).toHaveLength(result.config.horizonDays);
    const prior = Object.fromEntries(result.config.workflow.stages.map((stage) => [stage, 0]));
    result.snapshots.forEach((snapshot, day) => {
      const movements = result.dailyLog[day].movements;
      const changes = Object.fromEntries(result.config.workflow.stages.map((stage) => [stage, 0]));
      movements.forEach((movement) => {
        changes[movement.to] += movement.count;
        if (movement.from !== "External") changes[movement.from] -= movement.count;
      });
      result.config.workflow.stages.forEach((stage) => {
        expect(snapshot.states[stage] - prior[stage]).toBe(changes[stage]);
        prior[stage] = snapshot.states[stage];
      });
    });
  });

  it("supports a renamed and extended workflow", () => {
    const config = withWorkflow(scenarios.baseline, ["Ready", "Discovery", "Build", "Peer review", "Release", "Done"]);
    const result = runScenario(config, 42);
    expect(result.config.workflow.stages).toEqual(["Ready", "Discovery", "Build", "Peer review", "Release", "Done"]);
    expect(result.dailyLog[0].movements).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "Ready", to: "Discovery" }),
      expect.objectContaining({ from: "Discovery", to: "Build" }),
      expect.objectContaining({ from: "Build", to: "Peer review" }),
      expect.objectContaining({ from: "Peer review", to: "Release" }),
      expect.objectContaining({ from: "Release", to: "Done" }),
    ]));
  });

  it("keeps named swarm stages attached when a state is inserted", () => {
    const config = withWorkflow(scenarios.combined, ["Ready", "Discovery", "Development", "Review", "Test", "Done"]);
    expect(config.incident).toBeUndefined();
    expect(config.swarm?.sourceStage).toBe("Development");
    expect(config.swarm?.targetStage).toBe("Test");
  });

  it("keeps the demand stream identical across scenarios for the same seed", () => {
    const baseline = runScenario(scenarios.baseline, 6);
    const swarm = runScenario(scenarios.swarm, 6);
    expect(swarm.snapshots.map((snapshot) => snapshot.arrivals)).toEqual(baseline.snapshots.map((snapshot) => snapshot.arrivals));
  });

  it("averages daily CFD states across the requested seeds", () => {
    const mean = runMeanScenario(scenarios.baseline, 2, 6);
    expect(mean.seeds).toEqual([6, 7]);
    mean.config.workflow.stages.forEach((stage) => {
      expect(mean.snapshots[30].states[stage]).toBe((mean.runs[0].snapshots[30].states[stage] + mean.runs[1].snapshots[30].states[stage]) / 2);
    });
  });

  it("rejects an invalid mean CFD seed count", () => {
    expect(() => validateMeanSeedCount(0)).toThrow("The mean CFD seed count must be a positive whole number.");
    expect(() => validateMeanSeedCount(2.5)).toThrow("The mean CFD seed count must be a positive whole number.");
  });

  it("uses unused WIP-limited Development capacity to help Test at the configured effectiveness", () => {
    const config = {
      ...scenarios.wip,
      horizonDays: 2,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 1,
      baseRates: { Development: 0.4, Test: 0.1 },
      serviceEffort: { Development: { min: 0.4, max: 0.4 }, Test: { min: 3, max: 3 } },
      wipLimits: { Development: 1, Test: 1 },
      wipAssistanceEffectiveness: 0.75,
    };
    const result = runScenario(config, 1);
    const assistance = result.snapshots[1].capacityAssistance?.[0];
    expect(assistance).toMatchObject({ from: "Development", to: "Test", effectiveness: 0.75 });
    expect(assistance?.capacity).toBeCloseTo(0.3);
  });

  it("does not assist Test when Development uses all of its capacity", () => {
    const config = {
      ...scenarios.wip,
      horizonDays: 2,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 4,
      baseRates: { Development: 1.4, Test: 0.1 },
      serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 5, max: 5 } },
      wipLimits: { Development: 4, Test: 4 },
    };
    const result = runScenario(config, 1);
    expect(result.snapshots.flatMap((snapshot) => snapshot.capacityAssistance ?? [])).toEqual([]);
  });

  it("rejects WIP assistance effectiveness outside the supported range", () => {
    expect(() => validateWipAssistanceEffectiveness(1.1)).toThrow("WIP assistance effectiveness must be between zero and one.");
  });

  it("reduces capacity proportionally when concurrent work exceeds focus WIP", () => {
    const atFocus = effectiveCapacityFor(1.4, 2, { focusWip: 2, maximumConcurrency: 16, taskSwitchingLossRatio: 1 });
    const fullPenalty = effectiveCapacityFor(1.4, 4, { focusWip: 2, maximumConcurrency: 16, taskSwitchingLossRatio: 1 });
    const halfPenalty = effectiveCapacityFor(1.4, 4, { focusWip: 2, maximumConcurrency: 16, taskSwitchingLossRatio: 0.5 });
    expect(atFocus).toEqual({ effectiveCapacity: 1.4, taskSwitchingLoss: 0 });
    expect(fullPenalty).toEqual({ effectiveCapacity: 0.7, taskSwitchingLoss: 0.7 });
    expect(halfPenalty.effectiveCapacity).toBeCloseTo(1.05);
    expect(halfPenalty.taskSwitchingLoss).toBeCloseTo(0.35);
  });

  it("lets work enter a stage beyond operational concurrency while limiting active work", () => {
    const config = {
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 17,
      baseRates: { Development: 0.1, Test: 0.1 },
      serviceEffort: { Development: { min: 10, max: 10 }, Test: { min: 10, max: 10 } },
      operatingAssumptions: {
        Development: { focusWip: 16, maximumConcurrency: 16, taskSwitchingLossRatio: 0 },
        Test: { focusWip: 16, maximumConcurrency: 16, taskSwitchingLossRatio: 0 },
      },
      wipLimits: undefined,
    };
    const result = runScenario(config, 1);
    expect(result.snapshots[0].states).toMatchObject({ Backlog: 0, Development: 17 });
    expect(result.snapshots[0].active.Development).toBe(16);
    expect(result.snapshots[0].waiting.Development).toBe(1);
  });

  it("measures cycle time from first active work rather than arrival", () => {
    const metrics = calculateMetrics([
      {
        id: "FL-001",
        arrivedAt: 0,
        stage: "Done",
        status: "done",
        effortRemaining: 0,
        enteredAt: { Backlog: 0, Development: 3, Test: 6 },
        startedAt: { Development: 3, Test: 6 },
        completedAt: 8,
      },
    ], [], { ...scenarios.baseline, warmupDays: 0 });
    expect(metrics.medianCycleTime).toBe(5);
    expect(metrics.p85CycleTime).toBe(5);
  });

  it("rejects a maximum concurrency below focus WIP", () => {
    expect(() => validateOperatingAssumptions({ focusWip: 3, maximumConcurrency: 2, taskSwitchingLossRatio: 0.5 })).toThrow("Maximum concurrency must be at least focus WIP.");
  });
});
