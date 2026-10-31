import { describe, expect, it } from "vitest";
import { runScenario } from "./engine";
import { scenarios } from "./scenarios";
import { withWorkflow } from "./workflow";

describe("FlowLab simulation engine", () => {
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

  it("honours the Review WIP limit", () => {
    const result = runScenario(scenarios.wip, 42);
    expect(Math.max(...result.snapshots.map((snapshot) => snapshot.states.Review))).toBeLessThanOrEqual(6);
  });

  it("reduces Review queue-days with a scheduled swarm for the default seed", () => {
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

  it("keeps named interventions attached to their stage when a state is inserted", () => {
    const config = withWorkflow(scenarios.combined, ["Ready", "Discovery", "Development", "Review", "Test", "Done"]);
    expect(config.incident.stage).toBe("Review");
    expect(config.swarm?.sourceStage).toBe("Development");
    expect(config.swarm?.targetStage).toBe("Review");
  });
});
