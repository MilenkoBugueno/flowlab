import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runScenario } from "./engine";
import { configFromProjectFile, createProjectFile, parseProjectFile, phaseSettingsFor } from "./project";
import { scenarios } from "./scenarios";

function projectConfig() {
  const base = {
    ...scenarios.baseline,
    horizonDays: 4,
    warmupDays: 0,
    arrivalRatePerDay: 100,
    batchDays: [],
    batchSize: 0,
    initialInventory: undefined,
    initialBacklog: { pbiCount: 5, bugCount: 0 },
    featureBacklog: { featureCount: 10, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    baseRates: { Development: 0.1, Test: 0.1 },
    serviceEffort: { Development: { min: 10, max: 10 }, Test: { min: 10, max: 10 } },
  };
  const constrained = { ...base, wipLimits: { Development: 1, Integration: 1, Test: 1 } };
  return {
    ...base,
    projectPhases: [
      { id: "baseline", label: "Baseline", startDay: 0, endDay: 1, settings: phaseSettingsFor(base) },
      { id: "wip", label: "WIP Limits", startDay: 2, endDay: 3, settings: phaseSettingsFor(constrained) },
    ],
  };
}

describe("project files", () => {
  it("applies a phase at the start of its first day without removing existing work", () => {
    const result = runScenario(projectConfig(), 42);
    expect(result.features).toHaveLength(10);
    expect(result.snapshots[1].projectPhase?.label).toBe("Baseline");
    expect(result.snapshots[2].projectPhase?.label).toBe("WIP Limits");
    expect(result.snapshots[2].states.Development).toBe(15);
    expect(result.snapshots[2].states.Backlog).toBe(0);
  });

  it("round-trips a project header, phases, and seed", () => {
    const source = projectConfig();
    const file = createProjectFile(source, 42, "WIP transition");
    const loaded = parseProjectFile(JSON.stringify(file));
    expect(loaded.name).toBe("WIP transition");
    expect(loaded.seed).toBe(42);
    expect(loaded.config.featureBacklog?.featureCount).toBe(10);
    expect(configFromProjectFile(loaded).projectPhases).toEqual(source.projectPhases);
  });

  it("rejects incomplete and overlapping timelines", () => {
    const file = createProjectFile(projectConfig(), 42);
    file.phases = [
      { ...file.phases[0], endDay: 2 },
      { ...file.phases[1], startDay: 2 },
    ];
    expect(() => parseProjectFile(JSON.stringify(file))).toThrow("Project phases cannot overlap.");
    file.phases = [
      { ...file.phases[0], endDay: 0 },
      { ...file.phases[1], startDay: 2 },
    ];
    expect(() => parseProjectFile(JSON.stringify(file))).toThrow("Project phases must cover every simulation day exactly once.");
  });

  it("loads the published baseline-to-WIP example", () => {
    const sample = parseProjectFile(readFileSync("samples/baseline-to-wip.flowlab.json", "utf8"));
    expect(sample.config.featureBacklog?.featureCount).toBe(10);
    expect(sample.phases.map((phase) => phase.label)).toEqual(["Baseline", "WIP Limits"]);
    expect(sample.phases[1].startDay).toBe(51);
  });
});
