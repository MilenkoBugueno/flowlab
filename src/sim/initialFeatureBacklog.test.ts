import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initialFeatureBacklogFromSimulation, parseInitialFeatureBacklog } from "./initialFeatureBacklog";
import { runScenario } from "./engine";
import { scenarios } from "./scenarios";

describe("initial feature backlog files", () => {
  it("round-trips Feature and PBI IDs with empty short titles", () => {
    const backlog = parseInitialFeatureBacklog(JSON.stringify({
      formatVersion: 1,
      features: [{ id: "FEATURE-CHECKOUT", shortTitle: "", pbis: [{ id: "PBI-CHECKOUT-API", shortTitle: "" }] }],
    }));

    expect(backlog).toEqual({
      formatVersion: 1,
      features: [{ id: "FEATURE-CHECKOUT", shortTitle: "", pbis: [{ id: "PBI-CHECKOUT-API", shortTitle: "" }] }],
    });
  });

  it("exports only the initial Feature/PBI hierarchy, excluding raised Bugs", () => {
    const result = runScenario({
      ...scenarios.baseline,
      horizonDays: 1,
      warmupDays: 0,
      arrivalRatePerDay: 0,
      batchDays: [],
      batchSize: 0,
      initialInventory: {},
      featureBacklog: { featureCount: 1, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    }, 42);

    expect(initialFeatureBacklogFromSimulation(result)).toEqual({
      formatVersion: 1,
      features: [{ id: "FEATURE-001", shortTitle: "", pbis: [{ id: "PBI-001", shortTitle: "" }] }],
    });
  });

  it("keeps the industrial power-meter sample importable with a title for every Feature and PBI", () => {
    const sample = parseInitialFeatureBacklog(readFileSync("samples/flowlab-project-initial-feature-backlog.json", "utf8"));

    expect(sample.features).toHaveLength(10);
    expect(sample.features.flatMap((feature) => [feature.shortTitle, ...feature.pbis.map((pbi) => pbi.shortTitle)])).not.toContain("");
  });
});
