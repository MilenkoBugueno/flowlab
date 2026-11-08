import { describe, expect, it } from "vitest";
import { calculateMetrics, effectiveCapacityFor, runScenario, testingEffortFor } from "./engine";
import { runMeanScenario, validateMeanSeedCount } from "./mean";
import { projectPhasesForPlan } from "./project";
import { scenarios } from "./scenarios";
import { validateFeatureBacklog, validateFeatureFocus, validateInitialBacklog, validateInitialInventory, validateOperatingAssumptions, validateWipAssistanceEffectiveness } from "./settings";
import { withWorkflow } from "./workflow";

describe("FlowLab simulation engine", () => {
  it("uses the Test bottleneck workflow by default", () => {
    expect(scenarios.baseline.workflow.stages).toEqual(["Backlog", "Development", "Integration", "Test", "Done"]);
    expect(scenarios.baseline.workflow.handoffStages).toEqual(["Integration"]);
    expect(scenarios.baseline.arrivalRatePerDay).toBe(1.6);
    expect(scenarios.baseline.initialBacklog).toEqual({ pbiCount: 0, bugCount: 0 });
    expect(scenarios.baseline.baseRates).toEqual({ Development: 1.4, Test: 0.7 });
    expect(scenarios.baseline.operatingAssumptions).toEqual({
      Development: { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
      Test: { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
    });
    expect(scenarios.baseline.wipLimits).toBeUndefined();
    expect(scenarios.baseline.incident).toBeUndefined();
    expect(scenarios.baseline.featureFocus).toBeUndefined();
    expect(scenarios.swarm.featureFocus).toEqual({ startDay: 0 });
    expect(scenarios.swarm.swarm).toBeUndefined();
    expect(scenarios.combined.featureFocus).toEqual({ startDay: 0 });
    expect(scenarios.combined.wipLimits).toEqual({ Development: 5, Integration: 5, Test: 5 });
  });

  it("is deterministic for a fixed seed", () => {
    expect(runScenario(scenarios.baseline, 42).snapshots).toEqual(runScenario(scenarios.baseline, 42).snapshots);
  });

  it("adds delayed-feedback effort to testing as well as feedback fixes", () => {
    expect(testingEffortFor(1, 0.2, 3, 8)).toEqual({ effort: 2, delayDays: 5 });

    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 5,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 1,
      initialBacklog: { pbiCount: 1, bugCount: 0 },
      initialInventory: undefined,
      featureBacklog: { featureCount: 0, minPbisPerFeature: 5, maxPbisPerFeature: 10, baseBugEffort: 1, feedbackDelayEffortFactor: 0.5 },
      baseRates: { Development: 1, Test: 0.1 },
      serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 1, max: 1 } },
    }, 42);

    const item = result.items.find((candidate) => candidate.type === "PBI");
    expect(item?.enteredAt.Test).toBe(2);
    expect(item?.plannedEffort.Test).toBe(2);
  });

  it("keeps the finite initial backlog represented in every snapshot", () => {
    const result = runScenario({ ...scenarios.combined, initialBacklog: { pbiCount: 40, bugCount: 0 } }, 42);
    for (const snapshot of result.snapshots) {
      expect(Object.values(snapshot.states).reduce((total, count) => total + count, 0) + snapshot.externalBacklog).toBe(40);
    }
  });

  it("drains inherited work when WIP limits and finishing focus begin after a push phase", () => {
    const header = {
      ...scenarios.baseline,
      horizonDays: 100,
      featureBacklog: { featureCount: 10, minPbisPerFeature: 5, maxPbisPerFeature: 10, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 },
    };
    const config = {
      ...header,
      projectPhases: projectPhasesForPlan(header, [
        { id: "baseline", durationDays: 50, interventions: { wipLimits: false, featureFocus: false, backlogRanking: false } },
        { id: "mixed", durationDays: 50, interventions: { wipLimits: true, featureFocus: true, backlogRanking: true } },
      ]),
    };

    const result = runScenario(config, 42);
    const secondPhaseEvents = result.events.filter((event) => event.day >= 50);

    expect(secondPhaseEvents.length).toBeGreaterThan(0);
    expect(result.snapshots[99].states).not.toEqual(result.snapshots[50].states);
  });

  it("honours the Integration and Test WIP limits", () => {
    const result = runScenario(scenarios.wip, 42);
    expect(Math.max(...result.snapshots.map((snapshot) => snapshot.states.Test))).toBeLessThanOrEqual(6);
    expect(Math.max(...result.snapshots.map((snapshot) => snapshot.states.Integration))).toBeLessThanOrEqual(5);
  });

  it("uses Integration as a passive handoff buffer before Test", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 4,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 1,
      initialBacklog: { pbiCount: 1, bugCount: 0 },
      baseRates: { Development: 1, Test: 0.1 },
      serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 10, max: 10 } },
    }, 42);

    expect(result.snapshots[1].states.Integration).toBe(1);
    expect(result.snapshots[2].states.Test).toBe(1);
    expect(result.dailyLog[1].movements).toContainEqual({ from: "Development", to: "Integration", count: 1 });
    expect(result.dailyLog[2].movements).toContainEqual({ from: "Integration", to: "Test", count: 1 });
    expect(result.snapshots.flatMap((snapshot) => snapshot.operatingCapacity ?? []).some((capacity) => capacity.stage === "Integration")).toBe(false);
  });

  it("keeps Integration work waiting until Test has a WIP slot", () => {
    const result = runScenario({
      ...scenarios.wip,
      horizonDays: 4,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 1,
      initialBacklog: { pbiCount: 1, bugCount: 0 },
      baseRates: { Development: 1, Test: 0.1 },
      serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 10, max: 10 } },
      wipLimits: { Development: 1, Test: 0 },
    }, 42);

    expect(result.snapshots[3].states.Integration).toBe(1);
    expect(result.snapshots[3].states.Test).toBe(0);
  });

  it("does not deadlock a feature whose PBIs exceed the Development WIP limit", () => {
    const result = runScenario({
      ...scenarios.wip,
      initialInventory: {},
      featureBacklog: {
        featureCount: 1,
        minPbisPerFeature: 6,
        maxPbisPerFeature: 6,
        baseBugEffort: 1,
        feedbackDelayEffortFactor: 0.1,
      },
    }, 42);

    expect(result.features[0].pbiIds).toHaveLength(6);
    expect(result.snapshots[0].states.Development).toBe(5);
    expect(result.items.filter((item) => item.completedAt !== undefined)).not.toHaveLength(0);
    expect(result.features[0].completedAt).toBeDefined();
  });

  it("counts Feature PBIs waiting for the test gate against the Development WIP limit", () => {
    const result = runScenario({
      ...scenarios.wip,
      horizonDays: 40,
      initialInventory: {},
      featureBacklog: {
        featureCount: 1,
        minPbisPerFeature: 10,
        maxPbisPerFeature: 10,
        baseBugEffort: 1,
        feedbackDelayEffortFactor: 0,
      },
    }, 42);

    expect(result.snapshots.every((snapshot) => snapshot.states.Development <= 5)).toBe(true);
    expect(result.snapshots.every((snapshot) => snapshot.states.Integration <= 5)).toBe(true);
  });

  it("reduces Test queue-days with a scheduled swarm for the default seed", () => {
    const initialBacklog = { pbiCount: 200, bugCount: 0 };
    const baseline = runScenario({ ...scenarios.baseline, initialBacklog }, 42);
    const swarm = runScenario({
      ...scenarios.baseline,
      initialBacklog,
      swarm: { startDay: 45, durationDays: 10, sourceStage: "Development", targetStage: "Test", capacityShift: 0.5, rampUpEffectiveness: 0.75 },
    }, 42);
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

  it("keeps finishing focus attached when a state is inserted", () => {
    const config = withWorkflow(scenarios.combined, ["Ready", "Discovery", "Development", "Review", "Test", "Done"]);
    expect(config.incident).toBeUndefined();
    expect(config.featureFocus).toEqual({ startDay: 0 });
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
      horizonDays: 3,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 1,
      initialBacklog: { pbiCount: 1, bugCount: 0 },
      baseRates: { Development: 0.4, Test: 0.1 },
      serviceEffort: { Development: { min: 0.4, max: 0.4 }, Test: { min: 3, max: 3 } },
      wipLimits: { Development: 1, Test: 1 },
      wipAssistanceEffectiveness: 0.75,
    };
    const result = runScenario(config, 1);
    const assistance = result.snapshots[2].capacityAssistance?.[0];
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
      initialBacklog: { pbiCount: 17, bugCount: 0 },
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
        positionId: 0.5,
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
      batchDays: [0],
      batchSize: 3,
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

  it("uses the configured daily rate only to release existing Backlog work", () => {
    const config = {
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [],
      batchSize: 0,
      initialBacklog: { pbiCount: 2, bugCount: 1 },
      baseRates: { Development: 0.1, Test: 0.1 },
      serviceEffort: { Development: { min: 10, max: 10 }, Test: { min: 10, max: 10 } },
    };
    const result = runScenario(config, 42);
    expect(result.items).toHaveLength(3);
    expect(result.snapshots[0].states).toMatchObject({ Backlog: 3, Development: 0 });
    expect(result.snapshots[0].arrivals).toBe(0);
    expect(result.dailyLog[0].movements.find((movement) => movement.from === "External" && movement.to === "Backlog")?.count).toBe(0);
  });

  it("records board state that reconciles with each CFD snapshot", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 3,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 2,
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
      batchDays: [0],
      batchSize: 3,
      initialBacklog: { pbiCount: 2, bugCount: 0 },
      baseRates: { Development: 1, Test: 0.1 },
      serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 10, max: 10 } },
      operatingAssumptions: {
        Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
        Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      },
    }, 42);
    const worked = result.items.find((item) => item.firstStartedAt !== undefined);
    const waiting = result.items.find((item) => item.firstStartedAt === undefined);
    expect(worked?.progressPercent).toBeGreaterThan(0);
    expect(waiting?.progressPercent).toBe(0);
    expect(waiting?.firstStartedAt).toBeUndefined();
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

  it("decomposes configured features into deterministic linked PBIs", () => {
    const config = {
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 2,
      initialInventory: {},
      featureBacklog: { featureCount: 2, minPbisPerFeature: 3, maxPbisPerFeature: 3, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 },
      baseRates: { Development: 0.1, Test: 0.1 },
      serviceEffort: { Development: { min: 10, max: 10 }, Test: { min: 10, max: 10 } },
    };
    const first = runScenario(config, 42);
    const second = runScenario(config, 42);
    expect(first.features).toHaveLength(2);
    expect(first.features.every((feature) => feature.pbiIds.length === 3 && feature.title.length > 0)).toBe(true);
    expect(first.items.filter((item) => item.featureId).every((item) => item.type === "PBI" && item.featureTitle !== undefined)).toBe(true);
    expect(first.features).toEqual(second.features);
  });

  it("assigns initial backlog PBIs seeded random queue positions", () => {
    const config = {
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 2,
      initialInventory: {},
      featureBacklog: { featureCount: 3, minPbisPerFeature: 2, maxPbisPerFeature: 2, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    };
    const result = runScenario(config, 42);
    const repeated = runScenario(config, 42);
    const differentSeed = runScenario(config, 43);

    const positionIds = result.items.filter((item) => item.featureId).map((item) => item.positionId);
    const orderedFeatureIds = result.events
      .filter((event) => event.type === "entered-stage" && event.stage === "Development")
      .map((event) => result.items.find((item) => item.id === event.itemId)?.featureId);
    expect(new Set(positionIds).size).toBe(positionIds.length);
    expect(repeated.items.map((item) => item.positionId)).toEqual(result.items.map((item) => item.positionId));
    expect(differentSeed.items.map((item) => item.positionId)).not.toEqual(result.items.map((item) => item.positionId));
    expect(orderedFeatureIds).not.toEqual(["FEATURE-001", "FEATURE-001"]);
    expect(result.snapshots[0].states.Backlog).toBe(4);
  });

  it("admits ranked Feature backlog work before its random queue position", () => {
    const config = {
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [0],
      batchSize: 1,
      initialInventory: {},
      featureBacklog: { featureCount: 3, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    };
    const firstAdmittedFeature = (result: ReturnType<typeof runScenario>) => result.items.find((item) => item.enteredAt.Development === 0)?.featureId;
    const seed = Array.from({ length: 20 }, (_, index) => index + 1)
      .find((candidate) => firstAdmittedFeature(runScenario(config, candidate)) !== "FEATURE-001");
    expect(seed).toBeDefined();

    const unranked = runScenario(config, seed as number);
    const ranked = runScenario({ ...config, backlogRanking: true }, seed as number);
    expect(firstAdmittedFeature(unranked)).not.toBe("FEATURE-001");
    expect(firstAdmittedFeature(ranked)).toBe("FEATURE-001");
    expect(ranked.features.map((feature) => feature.ranking)).toEqual([1, 2, 3]);
    expect(ranked.items.filter((item) => item.featureId).every((item) => item.ranking === ranked.features.find((feature) => feature.id === item.featureId)?.ranking)).toBe(true);
  });

  it("pulls the highest-ranked Feature work first when Development is WIP-limited", () => {
    const result = runScenario({
      ...scenarios.wip,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      initialInventory: {},
      featureBacklog: { featureCount: 3, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
      wipLimits: { Development: 1, Integration: 5, Test: 5 },
      backlogRanking: true,
    }, 42);

    expect(result.items.find((item) => item.enteredAt.Development === 0)?.featureId).toBe("FEATURE-001");
    expect(result.items.filter((item) => item.stage === "Backlog").every((item) => item.ranking === undefined || item.ranking > 1)).toBe(true);
  });

  it("gates feature PBIs before Test and creates one delay-priced Bug for each tested PBI", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 15,
      warmupDays: 0,
      arrivalRatePerDay: 100,
      batchDays: [0],
      batchSize: 3,
      initialInventory: {},
      featureBacklog: { featureCount: 1, minPbisPerFeature: 3, maxPbisPerFeature: 3, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 },
      baseRates: { Development: 2, Test: 3 },
      serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 1, max: 1 } },
      operatingAssumptions: {
        Development: { focusWip: 2, maximumConcurrency: 2, taskSwitchingLossRatio: 0 },
        Test: { focusWip: 3, maximumConcurrency: 3, taskSwitchingLossRatio: 0 },
      },
    }, 42);
    const feature = result.features[0];
    const pbis = result.items.filter((item) => feature.pbiIds.includes(item.id));
    const testEntries = result.events.filter((event) => event.type === "entered-stage" && event.stage === "Test" && feature.pbiIds.includes(event.itemId));
    expect(testEntries).toHaveLength(3);
    expect(new Set(testEntries.map((event) => event.day))).toEqual(new Set([2, 3]));
    const bugs = result.items.filter((item) => feature.bugIds.includes(item.id));
    expect(bugs).toHaveLength(3);
    expect(bugs.every((bug) => bug.originatingPbiId && feature.pbiIds.includes(bug.originatingPbiId))).toBe(true);
    expect(feature.ranking).toBe(1);
    expect([...pbis, ...bugs].every((item) => item.ranking === feature.ranking)).toBe(true);
    expect(bugs.map((bug) => bug.plannedEffort.Development).sort()).toEqual([1.2, 1.2, 1.2]);
    expect(feature.handoffAt).toBe(Math.max(...testEntries.map((event) => event.day)));
    expect(feature.completedAt).toBeDefined();
    expect(result.metrics.completedFeatures).toBe(1);
    expect(pbis.every((pbi) => pbi.feedbackBugId !== undefined)).toBe(true);
  });

  it("lets individually developed Feature PBIs enter Test under WIP limits", () => {
    const result = runScenario({
      ...scenarios.wip,
      horizonDays: 8,
      initialInventory: {},
      featureBacklog: { featureCount: 1, minPbisPerFeature: 3, maxPbisPerFeature: 3, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
      baseRates: { Development: 2, Test: 1 },
      serviceEffort: { Development: { min: 5, max: 5 }, Test: { min: 10, max: 10 } },
      operatingAssumptions: {
        Development: { focusWip: 5, maximumConcurrency: 2, taskSwitchingLossRatio: 0 },
        Test: { focusWip: 5, maximumConcurrency: 5, taskSwitchingLossRatio: 0 },
      },
    }, 42);

    const feature = result.features[0];
    const firstTestEntry = Math.min(...result.events
      .filter((event) => event.type === "entered-stage" && event.stage === "Test" && feature.pbiIds.includes(event.itemId))
      .map((event) => event.day));
    const lastDevelopmentCompletion = Math.max(...feature.pbiIds.map((id) => result.items.find((item) => item.id === id)?.developedAt ?? -1));
    expect(firstTestEntry).toBeLessThan(lastDevelopmentCompletion);
  });

  it("tracks a Feature handoff at the final active stage of a custom workflow", () => {
    const result = runScenario({
      ...scenarios.baseline,
      workflow: { stages: ["Backlog", "Build", "Verify", "Done"] },
      horizonDays: 4,
      warmupDays: 0,
      arrivalRatePerDay: 100,
      batchDays: [0],
      batchSize: 1,
      initialInventory: {},
      featureBacklog: { featureCount: 1, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
      baseRates: { Build: 1, Verify: 1 },
      serviceEffort: { Build: { min: 1, max: 1 }, Verify: { min: 1, max: 1 } },
      operatingAssumptions: {
        Build: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
        Verify: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      },
    }, 42);

    expect(result.features[0].handoffAt).toBe(1);
    expect(result.items.find((item) => item.featureId === result.features[0].id)?.enteredAt.Verify).toBe(1);
  });

  it("validates initial backlog counts", () => {
    expect(() => validateInitialBacklog({ pbiCount: -1, bugCount: 0 })).toThrow("The initial PBI count must be a non-negative whole number.");
    expect(() => validateInitialBacklog({ pbiCount: 0, bugCount: 1.5 })).toThrow("The initial bug count must be a non-negative whole number.");
  });

  it("validates stage-specific initial inventory and excludes the final stage", () => {
    expect(() => validateInitialInventory(scenarios.baseline, { Test: { pbiCount: 0, bugCount: -1 } })).toThrow("The initial Test bug count must be a non-negative whole number.");
    expect(() => validateInitialInventory(scenarios.baseline, { Done: { pbiCount: 1, bugCount: 0 } })).toThrow("The final workflow stage, Done, cannot contain initial inventory.");
  });

  it("validates feature backlog configuration", () => {
    expect(() => validateFeatureBacklog({ featureCount: -1, minPbisPerFeature: 5, maxPbisPerFeature: 10, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 })).toThrow("The initial feature count must be a non-negative whole number.");
    expect(() => validateFeatureBacklog({ featureCount: 1, minPbisPerFeature: 8, maxPbisPerFeature: 5, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 })).toThrow("The maximum PBIs per feature must be at least the minimum.");
  });

  it("focuses admissions on the oldest unfinished Feature", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 100,
      batchDays: [],
      batchSize: 0,
      initialInventory: {},
      featureBacklog: { featureCount: 3, minPbisPerFeature: 2, maxPbisPerFeature: 2, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
      featureFocus: { startDay: 0 },
      baseRates: { Development: 2, Test: 1 },
      serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 1, max: 1 } },
      operatingAssumptions: {
        Development: { focusWip: 2, maximumConcurrency: 2, taskSwitchingLossRatio: 0 },
        Test: { focusWip: 2, maximumConcurrency: 2, taskSwitchingLossRatio: 0 },
      },
    }, 42);
    const developmentAdmissions = result.events.filter((event) => event.type === "entered-stage" && event.stage === "Development");
    expect(result.snapshots[0].featureFocus).toEqual({ id: "FEATURE-001", title: "Feature 001" });
    expect(developmentAdmissions).toHaveLength(2);
    expect(developmentAdmissions.every((event) => result.items.find((item) => item.id === event.itemId)?.featureId === "FEATURE-001")).toBe(true);
    expect(result.items.filter((item) => item.featureId !== "FEATURE-001").every((item) => item.stage === "Backlog")).toBe(true);
  });

  it("uses unused Development capacity to help Test for the focused Feature", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 3,
      warmupDays: 0,
      arrivalRatePerDay: 100,
      batchDays: [],
      batchSize: 0,
      initialInventory: {},
      featureBacklog: { featureCount: 2, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
      featureFocus: { startDay: 0 },
      baseRates: { Development: 1, Test: 0.1 },
      serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 5, max: 5 } },
      operatingAssumptions: {
        Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
        Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      },
    }, 42);
    expect(result.snapshots[2].capacityAssistance).toContainEqual(expect.objectContaining({
      from: "Development",
      to: "Test",
      reason: "completion-focus",
      featureId: "FEATURE-001",
    }));
    expect(result.dailyLog[2].featureFocus?.id).toBe("FEATURE-001");
  });

  it("leaves a workflow without Features unaffected by finishing focus", () => {
    const config = {
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 100,
      batchDays: [],
      batchSize: 0,
      initialBacklog: { pbiCount: 2, bugCount: 0 },
      initialInventory: undefined,
      featureBacklog: { featureCount: 0, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
      featureFocus: { startDay: 0 },
    };
    const focused = runScenario(config, 42);
    const regular = runScenario({ ...config, featureFocus: undefined }, 42);
    expect(focused.snapshots).toEqual(regular.snapshots);
    expect(focused.snapshots[0].featureFocus).toBeUndefined();
  });

  it("validates completion-focus start days", () => {
    expect(() => validateFeatureFocus(scenarios.baseline, { startDay: -1 })).toThrow("The completion-focus start day must be within the simulation horizon.");
    expect(() => validateFeatureFocus(scenarios.baseline, { startDay: scenarios.baseline.horizonDays })).toThrow("The completion-focus start day must be within the simulation horizon.");
  });

  it("rejects a maximum concurrency below focus WIP", () => {
    expect(() => validateOperatingAssumptions({ focusWip: 3, maximumConcurrency: 2, taskSwitchingLossRatio: 0.5 })).toThrow("Maximum concurrency must be at least focus WIP.");
  });
});
