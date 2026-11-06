import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runScenario } from "./engine";
import { baselineConfigForComparison, configForProjectDay, configFromProjectFile, createProjectFile, parseProjectFile, phasePlanFromProject, phaseSettingsFor, projectPhasesForPlan } from "./project";
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
  it("builds contiguous phase settings from an editable intervention plan", () => {
    const header = {
      ...scenarios.baseline,
      horizonDays: 50,
      arrivalRatePerDay: 2.4,
      baseRates: { Development: 2, Test: 1 },
    };
    const phases = projectPhasesForPlan(header, [
      { id: "baseline", scenarioId: "baseline", durationDays: 20 },
      { id: "wip", scenarioId: "wip", durationDays: 30 },
    ]);

    expect(phases.map(({ label, startDay, endDay }) => ({ label, startDay, endDay }))).toEqual([
      { label: "Baseline", startDay: 0, endDay: 19 },
      { label: "WIP Limits", startDay: 20, endDay: 49 },
    ]);
    expect(phases[0].settings.wipLimits).toBeUndefined();
    expect(phases[1].settings.wipLimits).toEqual({ Development: 5, Integration: 5, Test: 5 });
    expect(phases[1].settings.arrivalRatePerDay).toBe(2.4);
    expect(phases[1].settings.baseRates).toEqual({ Development: 2, Test: 1 });
  });

  it("adds backlog ranking to its selected phase profile", () => {
    const phases = projectPhasesForPlan({ ...scenarios.baseline, horizonDays: 20 }, [
      { id: "ranking", scenarioId: "ranking", durationDays: 20 },
    ]);
    expect(phases[0].label).toBe("Order backlog by ranking");
    expect(phases[0].settings.backlogRanking).toBe(true);
  });

  it("composes independently selected interventions in one phase", () => {
    const header = {
      ...scenarios.baseline,
      horizonDays: 30,
      wipLimits: { Development: 3, Integration: 2, Test: 1 },
    };
    const phases = projectPhasesForPlan(header, [
      {
        id: "mixed",
        durationDays: 30,
        interventions: { wipLimits: true, featureFocus: true, backlogRanking: true },
      },
    ]);

    expect(phases[0]).toMatchObject({
      label: "WIP Limits + Swarming + Order backlog by ranking",
      startDay: 0,
      endDay: 29,
      settings: {
        wipLimits: { Development: 3, Integration: 2, Test: 1 },
        featureFocus: { startDay: 0 },
        backlogRanking: true,
      },
    });
  });

  it("rejects a non-positive duration in an editable intervention plan", () => {
    expect(() => projectPhasesForPlan(scenarios.baseline, [{ id: "invalid", scenarioId: "baseline", durationDays: 0 }]))
      .toThrow("A phase duration must be a positive whole number.");
  });

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
    expect(phasePlanFromProject(loaded).map(({ scenarioId, durationDays }) => ({ scenarioId, durationDays }))).toEqual([
      { scenarioId: "baseline", durationDays: 2 },
      { scenarioId: "wip", durationDays: 2 },
    ]);
  });

  it("derives all enabled interventions when a mixed phase is reloaded", () => {
    const source = {
      ...scenarios.baseline,
      horizonDays: 20,
      projectPhases: projectPhasesForPlan(scenarios.baseline, [{
        id: "mixed",
        durationDays: 20,
        interventions: { wipLimits: true, featureFocus: true, backlogRanking: true },
      }]),
    };
    const loaded = parseProjectFile(JSON.stringify(createProjectFile(source, 42)));

    expect(phasePlanFromProject(loaded)[0]).toMatchObject({
      durationDays: 20,
      interventions: { wipLimits: true, featureFocus: true, backlogRanking: true },
    });
  });

  it("keeps operational settings while removing flow policies from a comparison baseline", () => {
    const selected = {
      ...scenarios.baseline,
      horizonDays: 20,
      arrivalRatePerDay: 2.4,
      baseRates: { Development: 5, Test: 2 },
      operatingAssumptions: {
        Development: { focusWip: 4, maximumConcurrency: 7, taskSwitchingLossRatio: 0.15 },
        Test: { focusWip: 5, maximumConcurrency: 5, taskSwitchingLossRatio: 0.2 },
      },
      featureBacklog: { featureCount: 10, minPbisPerFeature: 2, maxPbisPerFeature: 3, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 },
      wipLimits: { Development: 5, Integration: 5, Test: 5 },
      featureFocus: { startDay: 0 },
      backlogRanking: true,
      projectPhases: [{
        id: "mixed",
        label: "WIP Limits + Swarming + Order backlog by ranking",
        startDay: 0,
        endDay: 19,
        settings: {
          ...phaseSettingsFor({
            ...scenarios.baseline,
            arrivalRatePerDay: 2.4,
            baseRates: { Development: 5, Test: 2 },
            operatingAssumptions: {
              Development: { focusWip: 4, maximumConcurrency: 7, taskSwitchingLossRatio: 0.15 },
              Test: { focusWip: 5, maximumConcurrency: 5, taskSwitchingLossRatio: 0.2 },
            },
            wipLimits: { Development: 5, Integration: 5, Test: 5 },
            featureFocus: { startDay: 0 },
            backlogRanking: true,
          }),
        },
      }],
    };

    const baseline = baselineConfigForComparison(selected);
    const day = configForProjectDay(baseline, 10).config;

    expect(baseline.workflow).toEqual(selected.workflow);
    expect(baseline.featureBacklog).toEqual(selected.featureBacklog);
    expect(day.arrivalRatePerDay).toBe(2.4);
    expect(day.baseRates).toEqual({ Development: 5, Test: 2 });
    expect(day.operatingAssumptions).toEqual(selected.operatingAssumptions);
    expect(day.wipLimits).toBeUndefined();
    expect(day.featureFocus).toBeUndefined();
    expect(day.backlogRanking).toBe(false);
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
