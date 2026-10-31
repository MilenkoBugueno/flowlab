import { describe, expect, it } from "vitest";
import { runScenario } from "./engine";
import { scenarios } from "./scenarios";

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
    expect(Math.max(...result.snapshots.map((snapshot) => snapshot.states.review))).toBeLessThanOrEqual(6);
  });

  it("reduces Review queue-days with a scheduled swarm for the default seed", () => {
    const baseline = runScenario(scenarios.baseline, 42);
    const swarm = runScenario(scenarios.swarm, 42);
    expect(swarm.metrics.reviewQueueDays).toBeLessThan(baseline.metrics.reviewQueueDays);
  });
});
