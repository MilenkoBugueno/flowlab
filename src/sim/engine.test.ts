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

  it("records daily movements that reconcile with the CFD states", () => {
    const result = runScenario(scenarios.baseline, 42);
    expect(result.dailyLog).toHaveLength(result.config.horizonDays);
    const prior = { ready: 0, development: 0, review: 0, test: 0, done: 0 };
    result.snapshots.forEach((snapshot, day) => {
      const movements = result.dailyLog[day].movements;
      const changes = {
        ready: movements["external-to-ready"] - movements["ready-to-development"],
        development: movements["ready-to-development"] - movements["development-to-review"],
        review: movements["development-to-review"] - movements["review-to-test"],
        test: movements["review-to-test"] - movements["test-to-done"],
        done: movements["test-to-done"],
      };
      (Object.keys(prior) as Array<keyof typeof prior>).forEach((stage) => {
        expect(snapshot.states[stage] - prior[stage]).toBe(changes[stage]);
        prior[stage] = snapshot.states[stage];
      });
    });
  });
});
