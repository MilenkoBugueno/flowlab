import { describe, expect, it } from "vitest";
import { calculateMetrics, effectiveCapacityFor, runScenario } from "./engine";
import { runMeanScenario, validateMeanSeedCount } from "./mean";
import { scenarios } from "./scenarios";
import { validateArrivalPbiRatio, validateInitialBacklog, validateInitialInventory, validateOperatingAssumptions, validateWipAssistanceEffectiveness } from "./settings";
import { withWorkflow } from "./workflow";

describe("FlowLab simulation engine", () => {
  it("uses the Test bottleneck workflow by default", () => {
    expect(scenarios.baseline.workflow.stages).toEqual(["Backlog", "Development", "Test", "Done"]);
    expect(scenarios.baseline.arrivalRatePerDay).toBe(1.6);
    expect(scenarios.baseline.arrivalPbiRatio).toBe(0.8);
    expect(scenarios.baseline.initialBacklog).toEqual({ pbiCount: 0, bugCount: 0 });
    expect(scenarios.baseline.baseRates).toEqual({ Development: 1.4, Test: 0.7 });
    expect(scenarios.baseline.operatingAssumptions).toEqual({
      Development: { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
      Test: { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
    });
    expect(scenarios.baseline.wipLimits).toBeUndefined();
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
        title: "Product backlog item 1",
        type: "PBI",
        initial: false,
        arrivedAt: 0,
        stage: "Done",
        status: "done",
        active: false,
        progressPercent: 100,
        totalEffort: 2,
        completedEffort: 2,
        plannedEffort: { Development: 1, Test: 1 },
        effortRemaining: 0,
        enteredAt: { Backlog: 0, Development: 3, Test: 6 },
        startedAt: { Development: 3, Test: 6 },
        firstStartedAt: 3,
        completedAt: 8,
        history: [],
      },
    ], [], { ...scenarios.baseline, warmupDays: 0 });
    expect(metrics.medianCycleTime).toBe(5);
    expect(metrics.p85CycleTime).toBe(5);
  });

  it("seeds the configured PBI and bug inventory without counting it as new arrivals", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [],
      initialBacklog: { pbiCount: 2, bugCount: 1 },
      baseRates: { Development: 0.1, Test: 0.1 },
      serviceEffort: { Development: { min: 10, max: 10 }, Test: { min: 10, max: 10 } },
    }, 42);
    expect(result.items.map((item) => ({ id: item.id, title: item.title, type: item.type, initial: item.initial }))).toEqual([
      { id: "PBI-001", title: "Product backlog item 1", type: "PBI", initial: true },
      { id: "PBI-002", title: "Product backlog item 2", type: "PBI", initial: true },
      { id: "Bug-003", title: "Bug 3", type: "Bug", initial: true },
    ]);
    expect(result.snapshots[0].arrivals).toBe(0);
    expect(result.dailyLog[0].movements.find((movement) => movement.from === "External" && movement.to === "Backlog")?.count).toBe(0);
  });

  it("gives arriving work deterministic item metadata and item history", () => {
    const config = {
      ...scenarios.baseline,
      horizonDays: 2,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [1],
      batchSize: 3,
      arrivalPbiRatio: 0,
      initialBacklog: { pbiCount: 1, bugCount: 1 },
      baseRates: { Development: 0.1, Test: 0.1 },
      serviceEffort: { Development: { min: 10, max: 10 }, Test: { min: 10, max: 10 } },
    };
    const first = runScenario(config, 42);
    const second = runScenario(config, 42);
    const arrivals = first.items.filter((item) => !item.initial);
    expect(arrivals).toHaveLength(3);
    expect(arrivals.every((item) => item.type === "Bug" && item.title.length > 0 && item.history.length > 0)).toBe(true);
    expect(first.items.map((item) => ({ id: item.id, title: item.title, type: item.type, arrivedAt: item.arrivedAt }))).toEqual(
      second.items.map((item) => ({ id: item.id, title: item.title, type: item.type, arrivedAt: item.arrivedAt })),
    );
  });

  it("records board state that reconciles with each CFD snapshot", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 3,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [],
      initialBacklog: { pbiCount: 3, bugCount: 2 },
    }, 42);
    for (const snapshot of result.snapshots) {
      const states = Object.fromEntries(result.config.workflow.stages.map((stage) => [stage, 0]));
      result.items.forEach((item) => {
        const state = [...item.history].reverse().find((entry) => entry.day <= snapshot.day);
        if (state) states[state.stage] += 1;
      });
      expect(states).toEqual(snapshot.states);
    }
  });

  it("only advances progress for items that receive active capacity", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [],
      initialBacklog: { pbiCount: 2, bugCount: 0 },
      baseRates: { Development: 1, Test: 0.1 },
      serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 10, max: 10 } },
      operatingAssumptions: {
        Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
        Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      },
    }, 42);
    const [worked, waiting] = result.items;
    expect(worked.progressPercent).toBeGreaterThan(0);
    expect(waiting.progressPercent).toBe(0);
    expect(waiting.firstStartedAt).toBeUndefined();
  });

  it("seeds PBI and bug inventory directly into each configured non-terminal stage", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [],
      initialInventory: {
        Backlog: { pbiCount: 2, bugCount: 3 },
        Development: { pbiCount: 1, bugCount: 1 },
        Test: { pbiCount: 1, bugCount: 1 },
      },
      baseRates: { Development: 0.1, Test: 0.1 },
      serviceEffort: { Development: { min: 10, max: 10 }, Test: { min: 10, max: 10 } },
    }, 42);
    const seededAt = (stage: string, type: "PBI" | "Bug") => result.items.filter((item) => item.initial && item.type === type && item.history[0]?.stage === stage);
    expect(seededAt("Backlog", "PBI")).toHaveLength(2);
    expect(seededAt("Backlog", "Bug")).toHaveLength(3);
    expect(seededAt("Development", "PBI")).toHaveLength(1);
    expect(seededAt("Development", "Bug")).toHaveLength(1);
    expect(seededAt("Test", "PBI")).toHaveLength(1);
    expect(seededAt("Test", "Bug")).toHaveLength(1);
    expect(seededAt("Test", "PBI")[0].plannedEffort).toEqual({ Test: 10 });
  });

  it("allows a seeded stage inventory to exceed its WIP limit while enforcing the limit on later admissions", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [],
      initialInventory: { Development: { pbiCount: 8, bugCount: 0 } },
      wipLimits: { Development: 5, Test: 5 },
      baseRates: { Development: 0.1, Test: 0.1 },
      serviceEffort: { Development: { min: 10, max: 10 }, Test: { min: 10, max: 10 } },
    }, 42);
    expect(result.items.filter((item) => item.initial && item.history[0]?.stage === "Development")).toHaveLength(8);
    expect(result.snapshots[0].states.Development).toBe(8);
  });

  it("validates initial backlog counts and the arriving PBI share", () => {
    expect(() => validateInitialBacklog({ pbiCount: -1, bugCount: 0 })).toThrow("The initial PBI count must be a non-negative whole number.");
    expect(() => validateInitialBacklog({ pbiCount: 0, bugCount: 1.5 })).toThrow("The initial bug count must be a non-negative whole number.");
    expect(() => validateArrivalPbiRatio(1.1)).toThrow("The arriving PBI share must be between zero and one.");
  });

  it("validates stage-specific initial inventory and excludes the final stage", () => {
    expect(() => validateInitialInventory(scenarios.baseline, { Test: { pbiCount: 0, bugCount: -1 } })).toThrow("The initial Test bug count must be a non-negative whole number.");
    expect(() => validateInitialInventory(scenarios.baseline, { Done: { pbiCount: 1, bugCount: 0 } })).toThrow("The final workflow stage, Done, cannot contain initial inventory.");
  });

  it("rejects a maximum concurrency below focus WIP", () => {
    expect(() => validateOperatingAssumptions({ focusWip: 3, maximumConcurrency: 2, taskSwitchingLossRatio: 0.5 })).toThrow("Maximum concurrency must be at least focus WIP.");
  });
});
