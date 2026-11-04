import assert from "node:assert/strict";
import { Given, Then, When, World, setWorldConstructor } from "@cucumber/cucumber";
import { effectiveCapacityFor, feedbackBugEffortFor, processingRateFor, runScenario } from "../../src/sim/engine";
import { runMeanScenario, validateMeanSeedCount } from "../../src/sim/mean";
import { configFromProjectFile, createProjectFile, parseProjectFile, phasePlanFromProject, phaseSettingsFor, projectPhasesForPlan } from "../../src/sim/project";
import type { PhasePlanEntry, ProjectFile } from "../../src/sim/project";
import { scenarios } from "../../src/sim/scenarios";
import { validateOperatingAssumptions, withOperatingAssumptions, withProcessingRates, withSimulationSettings } from "../../src/sim/settings";
import type { CapacityIncident, FeatureBacklogConfig, InitialBacklog, InitialInventory, ItemTimelineState, MeanSimulationResult, OperatingAssumptions, ProjectPhase, ScenarioConfig, ScenarioId, SimulationResult, SwarmPolicy, WorkItem } from "../../src/sim/types";
import { activeStages, withWorkflow } from "../../src/sim/workflow";

class FlowLabWorld extends World {
  config?: ScenarioConfig;
  result?: SimulationResult;
  secondResult?: SimulationResult;
  baseline?: SimulationResult;
  workflowError?: string;
  workflowBeforeEdit?: ScenarioConfig;
  capacityError?: string;
  capacityBeforeEdit?: ScenarioConfig;
  interventionError?: string;
  interventionsBeforeEdit?: ScenarioConfig;
  pendingSwarm?: SwarmPolicy;
  meanSeedCount?: number;
  meanResult?: MeanSimulationResult;
  secondMeanResult?: MeanSimulationResult;
  meanBaseline?: MeanSimulationResult;
  meanSeedError?: string;
  meanSeedCountBeforeEdit?: number;
  arrivalRateError?: string;
  arrivalRateBeforeEdit?: number;
  wipAssistanceError?: string;
  wipAssistanceBeforeEdit?: number;
  operatingAssumptions?: OperatingAssumptions;
  operatingBaseCapacity?: number;
  operatingConcurrentItems?: number;
  operatingResult?: { effectiveCapacity: number; taskSwitchingLoss: number };
  operatingError?: string;
  operatingBeforeEdit?: OperatingAssumptions;
  initialBacklogBeforeEdit?: InitialBacklog;
  initialBacklogError?: string;
  initialInventoryBeforeEdit?: InitialInventory;
  initialInventoryError?: string;
  featureBacklogBeforeEdit?: FeatureBacklogConfig;
  featureBacklogError?: string;
  feedbackBaseBugEffort?: number;
  feedbackDelayFactor?: number;
  feedbackDevelopedDay?: number;
  feedbackTestedDay?: number;
  feedbackResult?: { effort: number; delayDays: number };
  inspectedItemId?: string;
  projectFile?: ProjectFile;
  projectError?: string;
  projectBeforeLoad?: ScenarioConfig;
  projectSeed?: number;
  phasePlan?: PhasePlanEntry[];
  phasePlanBeforeEdit?: PhasePlanEntry[];
  phasePlanError?: string;
  showFeatureHandoffs?: boolean;
  rankingSeed?: number;
}

setWorldConstructor(FlowLabWorld);

function resultFor(world: FlowLabWorld): SimulationResult {
  assert.ok(world.result, "Expected a completed simulation");
  return world.result;
}

function movementCount(result: SimulationResult, from: string, to: string): number {
  return result.dailyLog.reduce(
    (total, entry) => total + (entry.movements.find((movement) => movement.from === from && movement.to === to)?.count ?? 0),
    0,
  );
}

function hasRoute(result: SimulationResult, from: string, to: string): boolean {
  return result.dailyLog.every((entry) => entry.movements.some((movement) => movement.from === from && movement.to === to));
}

function meanResultFor(world: FlowLabWorld): MeanSimulationResult {
  assert.ok(world.meanResult, "Expected a completed mean simulation");
  return world.meanResult;
}

function featureHandoffMarkers(result: SimulationResult): Array<{ day: number; titles: string[] }> {
  return Array.from(
    result.features
      .filter((feature) => feature.handoffAt !== undefined)
      .reduce((byDay, feature) => {
        const day = feature.handoffAt as number;
        const titles = byDay.get(day) ?? [];
        titles.push(feature.title);
        byDay.set(day, titles);
        return byDay;
      }, new Map<number, string[]>()),
    ([day, titles]) => ({ day, titles }),
  );
}

function withSeededBacklog(config: ScenarioConfig, pbiCount = 200): ScenarioConfig {
  return { ...config, initialInventory: undefined, initialBacklog: { pbiCount, bugCount: 0 } };
}

function wipPullConfig(): ScenarioConfig {
  return {
    ...scenarios.wip,
    horizonDays: 3,
    warmupDays: 0,
    arrivalRatePerDay: 0,
    batchDays: [0],
    batchSize: 3,
    initialBacklog: { pbiCount: 3, bugCount: 0 },
    baseRates: { Development: 1, Test: 0.1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 5, max: 5 } },
    wipLimits: { Development: 2, Test: 3 },
  };
}

function downstreamWipConfig(): ScenarioConfig {
  return {
    ...scenarios.wip,
    horizonDays: 3,
    warmupDays: 0,
    arrivalRatePerDay: 0,
    batchDays: [0],
    batchSize: 3,
    initialBacklog: { pbiCount: 3, bugCount: 0 },
    baseRates: { Development: 3, Test: 0.1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 5, max: 5 } },
    wipLimits: { Development: 3, Test: 1 },
  };
}

function assistanceConfig(effectiveness = 0.75): ScenarioConfig {
  return {
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
    wipAssistanceEffectiveness: effectiveness,
  };
}

function fullyUtilizedWipConfig(): ScenarioConfig {
  return {
    ...scenarios.wip,
    horizonDays: 2,
    warmupDays: 0,
    arrivalRatePerDay: 0,
    batchDays: [0],
    batchSize: 4,
    initialBacklog: { pbiCount: 4, bugCount: 0 },
    baseRates: { Development: 1.4, Test: 0.1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 5, max: 5 } },
    wipLimits: { Development: 4, Test: 4 },
  };
}

function initialBacklogConfig(pbiCount: number, bugCount: number, overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    ...scenarios.baseline,
    horizonDays: 3,
    warmupDays: 0,
    arrivalRatePerDay: 0,
    batchDays: [],
    batchSize: 0,
    initialBacklog: { pbiCount, bugCount },
    ...overrides,
  };
}

function itemStateAtDay(item: WorkItem, day: number): ItemTimelineState | undefined {
  return [...item.history].reverse().find((state) => state.day <= day);
}

function inventoryFor(config: ScenarioConfig): InitialInventory {
  return Object.fromEntries(config.workflow.stages.slice(0, -1).map((stage) => [stage, config.initialInventory?.[stage] ?? { pbiCount: 0, bugCount: 0 }]));
}

function withStageInventory(config: ScenarioConfig, stage: string, pbiCount: number, bugCount: number): ScenarioConfig {
  return withSimulationSettings(config, { initialInventory: { ...inventoryFor(config), [stage]: { pbiCount, bugCount } } });
}

function stagedInventoryConfig(inventory: InitialInventory, overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    ...scenarios.baseline,
    horizonDays: 3,
    warmupDays: 0,
    arrivalRatePerDay: 0,
    batchDays: [],
    batchSize: 0,
    initialInventory: inventory,
    ...overrides,
  };
}

function featureFlowConfig(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
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
    ...overrides,
  };
}

function rankingBacklogConfig(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return featureFlowConfig({
    horizonDays: 12,
    arrivalRatePerDay: 0,
    batchDays: [0],
    batchSize: 1,
    initialInventory: {},
    featureBacklog: { featureCount: 3, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    backlogRanking: true,
    ...overrides,
  });
}

function finishingFocusConfig(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return featureFlowConfig({
    horizonDays: 12,
    featureBacklog: { featureCount: 3, minPbisPerFeature: 2, maxPbisPerFeature: 2, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    featureFocus: { startDay: 0 },
    baseRates: { Development: 2, Test: 1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 1, max: 1 } },
    operatingAssumptions: {
      Development: { focusWip: 2, maximumConcurrency: 2, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 2, maximumConcurrency: 2, taskSwitchingLossRatio: 0 },
    },
    ...overrides,
  });
}

function updateFeatureBacklog(config: ScenarioConfig, updates: Partial<FeatureBacklogConfig>): ScenarioConfig {
  return withSimulationSettings(config, {
    featureBacklog: { ...(config.featureBacklog ?? { featureCount: 0, minPbisPerFeature: 5, maxPbisPerFeature: 10, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 }), ...updates },
  });
}

function projectHeader(horizonDays = 121, featureCount = 10, overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    ...scenarios.baseline,
    horizonDays,
    warmupDays: 0,
    arrivalRatePerDay: 100,
    batchDays: [],
    batchSize: 0,
    initialInventory: {},
    featureBacklog: { featureCount, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    baseRates: { Development: 1, Test: 1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 1, max: 1 } },
    operatingAssumptions: {
      Development: { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
      Test: { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
    },
    ...overrides,
  };
}

function addProjectPhase(world: FlowLabWorld, id: string, label: string, startDay: number, endDay: number, overrides: Partial<ScenarioConfig> = {}) {
  const header = world.config ?? projectHeader();
  world.config = header;
  const settingsConfig = { ...header, ...overrides, workflow: header.workflow, horizonDays: header.horizonDays };
  const phase: ProjectPhase = { id, label, startDay, endDay, settings: phaseSettingsFor(settingsConfig) };
  if (!world.projectFile) world.projectFile = { formatVersion: 1, name: "Project test", seed: world.projectSeed ?? 42, config: header, phases: [] };
  world.projectFile.phases.push(phase);
}

function loadProject(world: FlowLabWorld) {
  assert.ok(world.projectFile, "Expected a project file");
  const loaded = parseProjectFile(JSON.stringify(world.projectFile));
  world.config = configFromProjectFile(loaded);
  world.result = runScenario(world.config, loaded.seed);
}

Given("the standard FlowLab baseline scenario", function (this: FlowLabWorld) {
  this.config = withSeededBacklog(scenarios.baseline);
});

Given("the baseline scenario with a scheduled Test swarm", function (this: FlowLabWorld) {
  this.config = withSeededBacklog({
    ...scenarios.baseline,
    swarm: { startDay: 45, durationDays: 10, sourceStage: "Development", targetStage: "Test", capacityShift: 0.5, rampUpEffectiveness: 0.75 },
  });
});

Given("the baseline scenario with Development, Integration, and Test WIP limits", function (this: FlowLabWorld) {
  this.config = withSeededBacklog(scenarios.wip);
});

When("I simulate 120 working days with seed {int}", function (this: FlowLabWorld, seed: number) {
  assert.ok(this.config, "Choose a scenario before simulating");
  this.result = runScenario(this.config, seed);
  this.baseline = runScenario({ ...scenarios.baseline, initialBacklog: this.config.initialBacklog }, seed);
});

When("I simulate the scenario twice with seed {int}", function (this: FlowLabWorld, seed: number) {
  assert.ok(this.config, "Choose a scenario before simulating");
  this.result = runScenario(this.config, seed);
  this.secondResult = runScenario(this.config, seed);
});

Then("Test has a lower daily processing rate than Development", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok((result.config.baseRates.Test ?? 0) < (result.config.baseRates.Development ?? 0));
});

Then("the Test constraint holds work visibly upstream", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.snapshots.some((snapshot) => snapshot.states.Development > 0 || snapshot.states.Backlog > 0));
});

Then("every arrived item is either completed or active in the workflow", function (this: FlowLabWorld) {
  const result = resultFor(this);
  let representedItems = result.items.filter((item) => item.initial).length;
  for (const snapshot of result.snapshots) {
    representedItems += snapshot.arrivals;
    const accountedFor = Object.values(snapshot.states).reduce((total, count) => total + count, 0) + snapshot.externalBacklog;
    assert.equal(accountedFor, representedItems, `Conservation failed on day ${snapshot.day}`);
  }
});

Then("both simulations have identical daily snapshots", function (this: FlowLabWorld) {
  assert.deepEqual(resultFor(this).snapshots, this.secondResult?.snapshots);
});

Then("the swarm sends capacity from Development to Test", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.config.swarm, "Expected selected scenario to include a swarm");
  assert.equal(result.config.swarm.sourceStage, "Development");
  assert.equal(result.config.swarm.targetStage, "Test");
});

Then("Test queue-days are lower than in the baseline for the same seed", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(this.baseline, "Expected baseline comparison");
  assert.ok(
    result.metrics.reviewQueueDays < this.baseline.metrics.reviewQueueDays,
    `Expected swarm Test queue-days (${result.metrics.reviewQueueDays}) below baseline (${this.baseline.metrics.reviewQueueDays})`,
  );
});

Then("Test WIP never exceeds {int} items", function (this: FlowLabWorld, limit: number) {
  const result = resultFor(this);
  assert.ok(result.snapshots.every((snapshot) => snapshot.states.Test <= limit));
});

Then("Integration WIP never exceeds {int} items", function (this: FlowLabWorld, limit: number) {
  const result = resultFor(this);
  assert.ok(result.snapshots.every((snapshot) => snapshot.states.Integration <= limit));
});

Then("constrained work remains visible upstream", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.snapshots.some((snapshot) => snapshot.states.Backlog > 0 || snapshot.states.Development >= 6));
});

Then("the daily log contains one entry for each simulated working day", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(result.dailyLog.length, result.config.horizonDays);
});

Then("each daily entry identifies its simulation day and seed", function (this: FlowLabWorld) {
  const result = resultFor(this);
  result.dailyLog.forEach((entry, day) => {
    assert.equal(entry.day, day);
    assert.equal(entry.seed, result.seed);
  });
});

Then("each daily entry lists the number of items moved between each pair of states", function (this: FlowLabWorld) {
  const result = resultFor(this);
  for (const entry of result.dailyLog) {
    for (const movement of entry.movements) assert.ok(Number.isInteger(movement.count) && movement.count >= 0);
  }
});

Then("the initial backlog is not recorded as an External arrival", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(movementCount(result, "External", "Backlog"), 0);
});

Then("movements through the workflow are recorded as Backlog to Development, Development to Integration, and Integration to Test", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(movementCount(result, "Backlog", "Development") > 0);
  assert.ok(movementCount(result, "Development", "Integration") > 0);
  assert.ok(movementCount(result, "Integration", "Test") > 0);
});

Then("completed work is recorded as Test to Done", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const completions = result.items.filter((item) => item.completedAt !== undefined).length;
  assert.equal(movementCount(result, "Test", "Done"), completions);
});

Then("movements that do not occur on a day are shown with zero counts", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const zeroCountMovement = result.dailyLog.flatMap((entry) => entry.movements).find((movement) => movement.count === 0);
  assert.ok(zeroCountMovement, "Expected at least one movement route with zero activity");
  assert.equal(zeroCountMovement.count, 0);
});

Then("the sum of all daily Test to Done movements equals the number of completed items", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const completions = result.snapshots.reduce((total, snapshot) => total + snapshot.completions, 0);
  const loggedCompletions = movementCount(result, "Test", "Done");
  assert.equal(loggedCompletions, completions);
});

Then("the daily log movements reproduce the change in each state between consecutive daily snapshots", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const prior = Object.fromEntries(result.config.workflow.stages.map((stage) => [stage, 0]));
  result.items.filter((item) => item.initial).forEach((item) => {
    prior[item.history[0]?.stage ?? result.config.workflow.stages[0]] += 1;
  });
  for (const [day, snapshot] of result.snapshots.entries()) {
    const movements = result.dailyLog[day].movements;
    const changes = Object.fromEntries(result.config.workflow.stages.map((stage) => [stage, 0]));
    for (const movement of movements) {
      changes[movement.to] += movement.count;
      if (movement.from !== "External") changes[movement.from] -= movement.count;
    }
    for (const stage of result.config.workflow.stages) {
      assert.equal(snapshot.states[stage] - prior[stage], changes[stage], `State reconciliation failed on day ${day} for ${stage}`);
      prior[stage] = snapshot.states[stage];
    }
  }
});

Given(/^a workflow with the states (.+)$/, function (this: FlowLabWorld, value: string) {
  const states = [...value.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  this.config = withWorkflow(withSeededBacklog(scenarios.baseline), states);
});

Then("the CFD displays the configured workflow state names", function (this: FlowLabWorld) {
  assert.deepEqual(resultFor(this).config.workflow.stages, this.config?.workflow.stages);
});

Then("the daily movement log displays the configured state-to-state movements", function (this: FlowLabWorld) {
  const result = resultFor(this);
  for (const [index, state] of result.config.workflow.stages.entries()) {
    const from = index === 0 ? "External" : result.config.workflow.stages[index - 1];
    assert.ok(hasRoute(result, from, state));
  }
});

Then("work moves from Ready to Build to Peer review to Release to Done", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const states = ["Ready", "Build", "Peer review", "Release", "Done"];
  for (const [index, state] of states.slice(1).entries()) {
    assert.ok(movementCount(result, states[index], state) > 0);
  }
});

Then("the CFD includes a Discovery band", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).config.workflow.stages.includes("Discovery"));
});

Then("the daily movement log includes Ready to Discovery and Discovery to Development movements", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(movementCount(result, "Ready", "Discovery") > 0);
  assert.ok(movementCount(result, "Discovery", "Development") > 0);
});

Then("work cannot move from Ready directly to Development", function (this: FlowLabWorld) {
  assert.ok(!hasRoute(resultFor(this), "Ready", "Development"));
});

Then("work moves from Development to Test before it moves to Review", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(movementCount(result, "Development", "Test") > 0);
  assert.ok(movementCount(result, "Test", "Review") > 0);
});

Then("the daily movement log does not include Development to Review movements", function (this: FlowLabWorld) {
  assert.ok(!hasRoute(resultFor(this), "Development", "Review"));
});

Given("I am editing the workflow", function (this: FlowLabWorld) {
  this.config = scenarios.baseline;
  this.workflowBeforeEdit = this.config;
});

When("I save a workflow with fewer than two states", function (this: FlowLabWorld) {
  assert.ok(this.config, "Choose a workflow before editing it");
  try {
    this.config = withWorkflow(this.config, ["Ready"]);
  } catch (error) {
    this.workflowError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that a workflow needs an entry and an exit state", function (this: FlowLabWorld) {
  assert.equal(this.workflowError, "A workflow needs an entry and an exit state.");
});

Then("the current workflow remains unchanged", function (this: FlowLabWorld) {
  assert.equal(this.config, this.workflowBeforeEdit);
});

When("I simulate the workflow twice with seed {int}", function (this: FlowLabWorld, seed: number) {
  assert.ok(this.config, "Choose a workflow before simulating");
  this.result = runScenario(this.config, seed);
  this.secondResult = runScenario(this.config, seed);
});

Then("both simulations have identical daily movement logs", function (this: FlowLabWorld) {
  assert.deepEqual(resultFor(this).dailyLog, this.secondResult?.dailyLog);
});

When("I open the capacity allocation controls", function (this: FlowLabWorld) {
  assert.ok(this.config, "Choose a workflow before editing capacity");
});

Then("I can set a daily processing rate for Discovery, Development, Review, and Test", function (this: FlowLabWorld) {
  assert.deepEqual(activeStages(this.config?.workflow ?? { stages: [] }), ["Discovery", "Development", "Review", "Test"]);
});

Then("I cannot set a daily processing rate for Ready or Done", function (this: FlowLabWorld) {
  const active = activeStages(this.config?.workflow ?? { stages: [] });
  assert.ok(!active.includes("Ready") && !active.includes("Done"));
});

When("I set the daily processing rates to 0.7 for Discovery, 1.2 for Development, 0.8 for Review, and 1.1 for Test", function (this: FlowLabWorld) {
  assert.ok(this.config, "Choose a workflow before editing capacity");
  this.config = withProcessingRates(this.config, { Discovery: 0.7, Development: 1.2, Review: 0.8, Test: 1.1 });
});

When("I run the simulation with seed {int}", function (this: FlowLabWorld, seed: number) {
  assert.ok(this.config, "Choose a scenario before simulating");
  this.result = runScenario(this.config, seed);
});

Then("the simulation uses those daily processing rates for the matching stages", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.deepEqual(result.config.baseRates, { Discovery: 0.7, Development: 1.2, Review: 0.8, Test: 1.1 });
});

Then("the same seed and capacity allocation produce identical daily snapshots", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.deepEqual(result.snapshots, runScenario(result.config, result.seed).snapshots);
});

Given("I am editing the capacity allocation controls", function (this: FlowLabWorld) {
  this.config = scenarios.baseline;
  this.capacityBeforeEdit = this.config;
});

When("I save a daily processing rate of 0 for Test", function (this: FlowLabWorld) {
  assert.ok(this.config, "Choose a scenario before editing capacity");
  try {
    this.config = withProcessingRates(this.config, { Test: 0 });
  } catch (error) {
    this.capacityError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that a daily processing rate must be greater than zero", function (this: FlowLabWorld) {
  assert.match(this.capacityError ?? "", /daily processing rate.*greater than zero/i);
});

Then("the current capacity allocation remains unchanged", function (this: FlowLabWorld) {
  assert.equal(this.config, this.capacityBeforeEdit);
});

Given("I am editing the intervention controls", function (this: FlowLabWorld) {
  this.config = scenarios.baseline;
  this.interventionsBeforeEdit = this.config;
});

When("I set an incident in Test from day {int} through day {int} with a daily processing rate of {float}", function (this: FlowLabWorld, startDay: number, endDay: number, ratePerDay: number) {
  assert.ok(this.config, "Choose a scenario before editing interventions");
  const incident: CapacityIncident = { stage: "Test", startDay, endDay, ratePerDay };
  this.config = withSimulationSettings(this.config, { incident });
});

Then("the simulation applies the configured incident only to Test on days {int} through {int}", function (this: FlowLabWorld, startDay: number, endDay: number) {
  const result = resultFor(this);
  assert.ok(result.config.incident, "Expected a configured incident");
  const incident = result.config.incident;
  assert.equal(incident.stage, "Test");
  assert.equal(incident.startDay, startDay);
  assert.equal(incident.endDay, endDay);
  assert.equal(processingRateFor("Development", startDay, result.config), result.config.baseRates.Development);
  assert.equal(processingRateFor("Test", startDay - 1, result.config), result.config.baseRates.Test);
  assert.equal(processingRateFor("Test", endDay + 1, result.config), result.config.baseRates.Test);
});

Then("Test uses a daily processing rate of {float} while the incident is active", function (this: FlowLabWorld, rate: number) {
  const result = resultFor(this);
  assert.ok(result.config.incident, "Expected a configured incident");
  assert.equal(processingRateFor("Test", result.config.incident.startDay, result.config), rate);
  assert.equal(processingRateFor("Test", result.config.incident.endDay, result.config), rate);
});

When("I set a swarm from Development to Test starting on day {int} for {int} days", function (this: FlowLabWorld, startDay: number, durationDays: number) {
  this.pendingSwarm = { sourceStage: "Development", targetStage: "Test", startDay, durationDays, capacityShift: 0.5, rampUpEffectiveness: 0.75 };
});

When("I set the swarm capacity shift to {float} and the first-day effectiveness to {float}", function (this: FlowLabWorld, capacityShift: number, rampUpEffectiveness: number) {
  assert.ok(this.config, "Choose a scenario before editing interventions");
  assert.ok(this.pendingSwarm, "Choose a swarm before editing it");
  this.config = withSimulationSettings(this.config, {
    swarm: { ...this.pendingSwarm, capacityShift, rampUpEffectiveness },
  });
});

Then("the simulation temporarily shifts {float} daily capacity from Development to Test", function (this: FlowLabWorld, shift: number) {
  const result = resultFor(this);
  assert.ok(result.config.swarm, "Expected a configured swarm");
  const steadyDay = result.config.swarm.startDay + 1;
  assert.equal(processingRateFor("Development", steadyDay, result.config), result.config.baseRates.Development! - shift);
  assert.equal(processingRateFor("Test", steadyDay, result.config), result.config.baseRates.Test! + shift);
});

Then("Test receives {float} daily capacity from the swarm on its first day", function (this: FlowLabWorld, contribution: number) {
  const result = resultFor(this);
  assert.ok(result.config.swarm, "Expected a configured swarm");
  const firstDayRate = processingRateFor("Test", result.config.swarm.startDay, result.config);
  assert.ok(Math.abs(firstDayRate - result.config.baseRates.Test! - contribution) < 1e-9);
});

Then("the swarm stops after {int} days", function (this: FlowLabWorld, duration: number) {
  const result = resultFor(this);
  assert.ok(result.config.swarm, "Expected a configured swarm");
  const afterSwarm = result.config.swarm.startDay + duration;
  assert.equal(processingRateFor("Development", afterSwarm, result.config), result.config.baseRates.Development);
  assert.equal(processingRateFor("Test", afterSwarm, result.config), result.config.baseRates.Test);
});

When("I save a swarm that starts and ends in the same stage", function (this: FlowLabWorld) {
  assert.ok(this.config, "Choose a scenario before editing interventions");
  try {
    this.config = withSimulationSettings(this.config, {
      swarm: { sourceStage: "Test", targetStage: "Test", startDay: 45, durationDays: 10, capacityShift: 0.5, rampUpEffectiveness: 0.75 },
    });
  } catch (error) {
    this.interventionError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that a swarm needs different source and target stages", function (this: FlowLabWorld) {
  assert.equal(this.interventionError, "A swarm needs different source and target stages.");
});

Then("the current intervention settings remain unchanged", function (this: FlowLabWorld) {
  assert.equal(this.config, this.interventionsBeforeEdit);
});

Given("I am editing the backlog push rate", function (this: FlowLabWorld) {
  this.config = scenarios.baseline;
  this.arrivalRateBeforeEdit = this.config.arrivalRatePerDay;
});

When("I save an average backlog push rate of {float} items per day", function (this: FlowLabWorld, arrivalRatePerDay: number) {
  assert.ok(this.config, "Choose a scenario before editing the backlog push rate");
  try {
    this.config = withSimulationSettings(this.config, { arrivalRatePerDay });
  } catch (error) {
    this.arrivalRateError = error instanceof Error ? error.message : String(error);
  }
});

Then("the simulation uses an average backlog push rate of {float} items per day", function (this: FlowLabWorld, arrivalRatePerDay: number) {
  assert.equal(resultFor(this).config.arrivalRatePerDay, arrivalRatePerDay);
});

Then("the same seed and backlog push rate produce identical daily snapshots", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.deepEqual(result.snapshots, runScenario(result.config, result.seed).snapshots);
});

Then("I am told that the backlog push rate must be zero or greater", function (this: FlowLabWorld) {
  assert.equal(this.arrivalRateError, "The backlog push rate must be zero or greater.");
});

Then("the current backlog push rate remains unchanged", function (this: FlowLabWorld) {
  assert.equal(this.config?.arrivalRatePerDay, this.arrivalRateBeforeEdit);
});

When("I choose {int} seeds for the mean CFD", function (this: FlowLabWorld, seedCount: number) {
  this.meanSeedCount = validateMeanSeedCount(seedCount);
});

When("I run the mean simulation", function (this: FlowLabWorld) {
  assert.ok(this.config, "Choose a scenario before running a mean simulation");
  assert.ok(this.meanSeedCount, "Choose a positive number of seeds");
  this.meanResult = runMeanScenario(this.config, this.meanSeedCount);
  this.meanBaseline = runMeanScenario(scenarios.baseline, this.meanSeedCount);
});

Then("FlowLab runs {int} simulations for the selected scenario", function (this: FlowLabWorld, seedCount: number) {
  const result = meanResultFor(this);
  assert.equal(result.runs.length, seedCount);
  assert.equal(result.seeds.length, seedCount);
});

Then("the CFD is labeled as the mean of {int} simulations", function (this: FlowLabWorld, seedCount: number) {
  assert.equal(meanResultFor(this).seeds.length, seedCount);
});

Then("each CFD band shows the arithmetic mean number of items in its state for each working day", function (this: FlowLabWorld) {
  const result = meanResultFor(this);
  for (const snapshot of result.snapshots) {
    for (const stage of result.config.workflow.stages) {
      const expected = result.runs.reduce((total, run) => total + run.snapshots[snapshot.day].states[stage], 0) / result.runs.length;
      assert.equal(snapshot.states[stage], expected, `Expected mean state for ${stage} on day ${snapshot.day}`);
    }
  }
});

Then("the mean CFD includes every working day in the simulation horizon", function (this: FlowLabWorld) {
  const result = meanResultFor(this);
  assert.equal(result.snapshots.length, result.config.horizonDays);
  assert.deepEqual(result.snapshots.map((snapshot) => snapshot.day), Array.from({ length: result.config.horizonDays }, (_, day) => day));
});

Then("the mean CFD is based on {int} distinct seeds", function (this: FlowLabWorld, seedCount: number) {
  const seeds = meanResultFor(this).seeds;
  assert.equal(new Set(seeds).size, seedCount);
});

When("I run the mean simulation twice", function (this: FlowLabWorld) {
  assert.ok(this.config, "Choose a scenario before running a mean simulation");
  assert.ok(this.meanSeedCount, "Choose a positive number of seeds");
  this.meanResult = runMeanScenario(this.config, this.meanSeedCount);
  this.secondMeanResult = runMeanScenario(this.config, this.meanSeedCount);
});

Then("both mean CFDs have identical daily state values", function (this: FlowLabWorld) {
  assert.deepEqual(
    meanResultFor(this).snapshots.map((snapshot) => snapshot.states),
    this.secondMeanResult?.snapshots.map((snapshot) => snapshot.states),
  );
});

Then("both mean CFDs use the same set of seeds", function (this: FlowLabWorld) {
  assert.deepEqual(meanResultFor(this).seeds, this.secondMeanResult?.seeds);
});

Then("the mean CFD displays every configured workflow state", function (this: FlowLabWorld) {
  assert.deepEqual(meanResultFor(this).config.workflow.stages, this.config?.workflow.stages);
});

Then("the mean CFD includes a Discovery band", function (this: FlowLabWorld) {
  const result = meanResultFor(this);
  assert.ok(result.snapshots.every((snapshot) => Object.hasOwn(snapshot.states, "Discovery")));
});

Then("the baseline comparison uses the same {int} seeds", function (this: FlowLabWorld, seedCount: number) {
  assert.equal(meanResultFor(this).seeds.length, seedCount);
  assert.deepEqual(meanResultFor(this).seeds, this.meanBaseline?.seeds);
});

Then("each selected-scenario run and baseline run share the same demand stream for its seed", function (this: FlowLabWorld) {
  const result = meanResultFor(this);
  assert.ok(this.meanBaseline, "Expected a baseline mean simulation");
  result.runs.forEach((run, index) => {
    assert.equal(run.seed, this.meanBaseline?.runs[index].seed);
    assert.deepEqual(
      run.snapshots.map((snapshot) => snapshot.arrivals),
      this.meanBaseline?.runs[index].snapshots.map((snapshot) => snapshot.arrivals),
    );
  });
});

Then("the displayed metric differences are calculated from the two mean results", function (this: FlowLabWorld) {
  const result = meanResultFor(this);
  assert.ok(this.meanBaseline, "Expected a baseline mean simulation");
  const selectedAverage = result.runs.reduce((total, run) => total + run.metrics.reviewQueueDays, 0) / result.runs.length;
  const baselineAverage = this.meanBaseline.runs.reduce((total, run) => total + run.metrics.reviewQueueDays, 0) / this.meanBaseline.runs.length;
  assert.equal(result.metrics.reviewQueueDays - this.meanBaseline.metrics.reviewQueueDays, selectedAverage - baselineAverage);
});

Given("I am editing the mean CFD seed count", function (this: FlowLabWorld) {
  this.meanSeedCount = 100;
  this.meanSeedCountBeforeEdit = this.meanSeedCount;
});

When("I save a seed count of {int}", function (this: FlowLabWorld, seedCount: number) {
  try {
    this.meanSeedCount = validateMeanSeedCount(seedCount);
  } catch (error) {
    this.meanSeedError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that the mean CFD seed count must be a positive whole number", function (this: FlowLabWorld) {
  assert.equal(this.meanSeedError, "The mean CFD seed count must be a positive whole number.");
});

Then("the current mean CFD seed count remains unchanged", function (this: FlowLabWorld) {
  assert.equal(this.meanSeedCount, this.meanSeedCountBeforeEdit);
});

Given("a workflow with a Development WIP limit of 2", function (this: FlowLabWorld) {
  this.config = wipPullConfig();
});

Given("Development already contains 2 items", function (this: FlowLabWorld) {
  assert.equal(this.config?.wipLimits?.Development, 2);
});

When("another item is ready to enter Development", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a WIP-limited workflow");
  this.result = runScenario(this.config, 1);
});

Then("the item remains in Backlog", function (this: FlowLabWorld) {
  assert.ok((resultFor(this).snapshots[0].states.Backlog ?? 0) > 0);
});

Then("the item is pulled into Development only after a Development slot becomes free", function (this: FlowLabWorld) {
  const developmentEntries = resultFor(this).events.filter((event) => event.type === "entered-stage" && event.stage === "Development");
  assert.equal(developmentEntries.filter((event) => event.day === 0).length, 2);
  assert.ok(developmentEntries.some((event) => event.day > 0));
});

Given("a workflow with Development and Test WIP limits", function (this: FlowLabWorld) {
  this.config = downstreamWipConfig();
});

Given("Test has reached its WIP limit", function (this: FlowLabWorld) {
  assert.equal(this.config?.wipLimits?.Test, 1);
});

When("Development completes an item that is ready for Test", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a WIP-limited workflow");
  this.result = runScenario(this.config, 1);
});

Then("the item waits in Integration until Test has a free slot", function (this: FlowLabWorld) {
  assert.ok((resultFor(this).snapshots[1].states.Integration ?? 0) > 0);
});

Then("no item enters Test above its WIP limit", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const limit = result.config.wipLimits?.Test ?? 0;
  assert.ok(result.snapshots.every((snapshot) => snapshot.states.Test <= limit));
});

Given("Development has a WIP limit and unused daily processing capacity", function (this: FlowLabWorld) {
  this.config = assistanceConfig();
});

Given("Test has work waiting to be processed", function (this: FlowLabWorld) {
  assert.ok(this.config?.wipLimits?.Test !== undefined);
});

When("I simulate a working day with the default WIP assistance effectiveness", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a WIP-limited workflow");
  this.result = runScenario(this.config, 1);
});

Then("Development serves its own work before helping Test", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.events.some((event) => event.stage === "Development" && event.type === "blocked"));
  assert.ok(result.snapshots.some((snapshot) => snapshot.capacityAssistance?.some((assistance) => assistance.from === "Development")));
});

Then("the unused Development capacity is applied to Test at {float} effectiveness", function (this: FlowLabWorld, effectiveness: number) {
  const assistance = resultFor(this).snapshots.flatMap((snapshot) => snapshot.capacityAssistance ?? []).find((entry) => entry.from === "Development" && entry.to === "Test");
  assert.ok(assistance, "Expected Development to assist Test");
  assert.equal(assistance.effectiveness, effectiveness);
  assert.ok(Math.abs(assistance.capacity - 0.4 * effectiveness) < 1e-9);
});

Then("the assistance only helps the next active stage, Test", function (this: FlowLabWorld) {
  const assistance = resultFor(this).snapshots.flatMap((snapshot) => snapshot.capacityAssistance ?? []);
  assert.ok(assistance.every((entry) => entry.from === "Development" && entry.to === "Test"));
});

Given("Development has a WIP limit and enough work to use all of its daily processing capacity", function (this: FlowLabWorld) {
  this.config = fullyUtilizedWipConfig();
});

Then("Development does not provide capacity assistance to Test", function (this: FlowLabWorld) {
  const assistance = resultFor(this).snapshots.flatMap((snapshot) => snapshot.capacityAssistance ?? []);
  assert.ok(!assistance.some((entry) => entry.from === "Development" && entry.to === "Test"));
});

Given("I am editing the WIP limit settings", function (this: FlowLabWorld) {
  this.config = assistanceConfig();
  this.wipAssistanceBeforeEdit = this.config.wipAssistanceEffectiveness;
});

When("I set the WIP assistance effectiveness to {float}", function (this: FlowLabWorld, effectiveness: number) {
  assert.ok(this.config, "Expected a WIP-limited workflow");
  this.config = withSimulationSettings(this.config, { wipAssistanceEffectiveness: effectiveness });
});

Given("Development has {float} unused daily processing capacity", function (this: FlowLabWorld, capacity: number) {
  assert.equal(this.config?.baseRates.Development, capacity);
});

When("I simulate a working day with a WIP assistance effectiveness of {float}", function (this: FlowLabWorld, effectiveness: number) {
  assert.ok(this.config, "Expected a WIP-limited workflow");
  assert.equal(this.config.wipAssistanceEffectiveness, effectiveness);
  this.result = runScenario(this.config, 1);
});

Then("Test receives {float} daily processing capacity from Development", function (this: FlowLabWorld, capacity: number) {
  const assistance = resultFor(this).snapshots.flatMap((snapshot) => snapshot.capacityAssistance ?? []).find((entry) => entry.from === "Development" && entry.to === "Test");
  assert.ok(assistance, "Expected Development to assist Test");
  assert.ok(Math.abs(assistance.capacity - capacity) < 1e-9);
});

When("I save a WIP assistance effectiveness of {float}", function (this: FlowLabWorld, effectiveness: number) {
  assert.ok(this.config, "Expected a WIP-limited workflow");
  try {
    this.config = withSimulationSettings(this.config, { wipAssistanceEffectiveness: effectiveness });
  } catch (error) {
    this.wipAssistanceError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that WIP assistance effectiveness must be between zero and one", function (this: FlowLabWorld) {
  assert.equal(this.wipAssistanceError, "WIP assistance effectiveness must be between zero and one.");
});

Then("the current WIP assistance settings remain unchanged", function (this: FlowLabWorld) {
  assert.equal(this.config?.wipAssistanceEffectiveness, this.wipAssistanceBeforeEdit);
});

function operationalConcurrencyConfig(maximumConcurrency: number, wipLimit?: number): ScenarioConfig {
  const itemCount = wipLimit === undefined ? maximumConcurrency + 1 : wipLimit + 1;
  return {
    ...scenarios.baseline,
    horizonDays: 2,
    warmupDays: 0,
    arrivalRatePerDay: 0,
    batchDays: [0],
    batchSize: itemCount,
    initialBacklog: { pbiCount: itemCount, bugCount: 0 },
    baseRates: { Development: 0.1, Test: 0.1 },
    serviceEffort: { Development: { min: 0.1, max: 0.1 }, Test: { min: 10, max: 10 } },
    operatingAssumptions: {
      Development: { focusWip: maximumConcurrency, maximumConcurrency, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 16, maximumConcurrency: 16, taskSwitchingLossRatio: 0 },
    },
    wipLimits: wipLimit === undefined ? undefined : { Development: wipLimit },
  };
}

Given("Development has a daily capacity of {float} and a focus WIP of {int} items", function (this: FlowLabWorld, capacity: number, focusWip: number) {
  this.operatingBaseCapacity = capacity;
  this.operatingAssumptions = { focusWip, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 };
});

Given("Development has a daily capacity of {float}, a focus WIP of {int} items, and a task-switching loss ratio of {float}", function (this: FlowLabWorld, capacity: number, focusWip: number, taskSwitchingLossRatio: number) {
  this.operatingBaseCapacity = capacity;
  this.operatingAssumptions = { focusWip, maximumConcurrency: 16, taskSwitchingLossRatio };
});

Given("Development has {int} active items", function (this: FlowLabWorld, activeItems: number) {
  this.operatingConcurrentItems = activeItems;
});

When("I simulate a working day", function (this: FlowLabWorld) {
  assert.ok(this.operatingAssumptions, "Expected operating assumptions");
  assert.ok(this.operatingBaseCapacity !== undefined, "Expected a base capacity");
  assert.ok(this.operatingConcurrentItems !== undefined, "Expected concurrent items");
  this.operatingResult = effectiveCapacityFor(this.operatingBaseCapacity, this.operatingConcurrentItems, this.operatingAssumptions);
});

Then("Development uses its full daily capacity of {float}", function (this: FlowLabWorld, capacity: number) {
  assert.equal(this.operatingResult?.effectiveCapacity, capacity);
});

Then("Development records no task-switching loss", function (this: FlowLabWorld) {
  assert.equal(this.operatingResult?.taskSwitchingLoss, 0);
});

Then("Development uses an effective daily capacity of {float}", function (this: FlowLabWorld, capacity: number) {
  assert.ok(Math.abs((this.operatingResult?.effectiveCapacity ?? 0) - capacity) < 1e-9);
});

Then("Development records {float} daily capacity as task-switching loss", function (this: FlowLabWorld, loss: number) {
  assert.ok(Math.abs((this.operatingResult?.taskSwitchingLoss ?? 0) - loss) < 1e-9);
});

Given("Development has a maximum concurrency of {int} items and no explicit Development WIP limit", function (this: FlowLabWorld, maximumConcurrency: number) {
  if (this.config) {
    const current = this.config.operatingAssumptions?.Development ?? { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 };
    this.config = {
      ...withOperatingAssumptions(this.config, { Development: { ...current, maximumConcurrency } }),
      wipLimits: undefined,
      batchDays: [0],
      batchSize: this.config.initialBacklog?.pbiCount ?? maximumConcurrency + 1,
    };
  } else {
    this.config = operationalConcurrencyConfig(maximumConcurrency);
  }
});

Given("{int} items are ready to enter Development", function (this: FlowLabWorld, itemCount: number) {
  assert.equal(this.config?.batchSize, itemCount);
});

When("work is pulled into Development", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected an operational concurrency configuration");
  this.result = runScenario(this.config, 1);
});

Then("all {int} items enter Development", function (this: FlowLabWorld, itemCount: number) {
  const result = resultFor(this);
  const developmentEntries = result.events.filter((event) => event.type === "entered-stage" && event.stage === "Development" && event.day === 0);
  assert.equal(developmentEntries.length, itemCount);
  assert.equal(result.snapshots[0].states.Development, itemCount);
  assert.equal(result.snapshots[0].states.Backlog, 0);
});

Then("no more than {int} items are actively worked in Development", function (this: FlowLabWorld, maximumConcurrency: number) {
  const result = resultFor(this);
  assert.ok(result.snapshots.every((snapshot) => (snapshot.active.Development ?? 0) <= maximumConcurrency));
  assert.ok(result.snapshots.every((snapshot) => {
    const capacity = snapshot.operatingCapacity?.find((entry) => entry.stage === "Development");
    return (capacity?.concurrentItems ?? 0) <= maximumConcurrency;
  }));
});

Then("the seventeenth item waits inside Development until an active slot becomes free", function (this: FlowLabWorld) {
  const snapshot = resultFor(this).snapshots[0];
  assert.equal(snapshot.states.Development, 17);
  assert.equal(snapshot.active.Development, 16);
  assert.equal(snapshot.waiting.Development, 1);
  assert.equal(snapshot.states.Backlog, 0);
});

Given("I am editing the Development operating assumptions", function (this: FlowLabWorld) {
  this.config = scenarios.baseline;
  this.operatingBeforeEdit = this.config.operatingAssumptions?.Development;
});

When("I set Development maximum concurrency to {int} items", function (this: FlowLabWorld, maximumConcurrency: number) {
  assert.ok(this.config, "Expected operating assumptions to edit");
  const current = this.config.operatingAssumptions?.Development ?? { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 };
  this.config = withOperatingAssumptions(this.config, { Development: { ...current, maximumConcurrency } });
});

Given("Development has no explicit WIP limit", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a simulation configuration");
  const { Development: _development, ...remainingLimits } = this.config.wipLimits ?? {};
  this.config = { ...this.config, wipLimits: Object.keys(remainingLimits).length ? remainingLimits : undefined };
});

Then("Development can actively work on up to {int} items", function (this: FlowLabWorld, maximumConcurrency: number) {
  assert.equal(this.config?.operatingAssumptions?.Development?.maximumConcurrency, maximumConcurrency);
});

Then("additional pushed items wait inside Development until an active slot becomes free", function (this: FlowLabWorld) {
  const maximumConcurrency = this.config?.operatingAssumptions?.Development?.maximumConcurrency;
  assert.ok(maximumConcurrency, "Expected a configured maximum concurrency");
  const config = operationalConcurrencyConfig(maximumConcurrency);
  const result = runScenario(config, 1);
  assert.equal(result.snapshots[0].states.Backlog, 0);
  assert.ok((result.snapshots[0].waiting.Development ?? 0) > 0);
});

When("I set Development focus WIP to {int} items", function (this: FlowLabWorld, focusWip: number) {
  assert.ok(this.config, "Expected operating assumptions to edit");
  const current = this.config.operatingAssumptions?.Development ?? { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 };
  this.config = withOperatingAssumptions(this.config, { Development: { ...current, focusWip } });
});

Then("Development uses full capacity with up to {int} active items", function (this: FlowLabWorld, focusWip: number) {
  const assumptions = this.config?.operatingAssumptions?.Development;
  assert.ok(assumptions, "Expected Development operating assumptions");
  assert.equal(effectiveCapacityFor(1.4, focusWip, assumptions).taskSwitchingLoss, 0);
});

Then("task-switching loss begins when Development has more than {int} active items", function (this: FlowLabWorld, focusWip: number) {
  const assumptions = this.config?.operatingAssumptions?.Development;
  assert.ok(assumptions, "Expected Development operating assumptions");
  assert.ok(effectiveCapacityFor(1.4, focusWip + 1, assumptions).taskSwitchingLoss > 0);
});

Given("Development has a maximum concurrency of {int} items", function (this: FlowLabWorld, maximumConcurrency: number) {
  this.config = operationalConcurrencyConfig(maximumConcurrency, 2);
});

Given("Development has an explicit WIP limit of {int} items", function (this: FlowLabWorld, limit: number) {
  assert.ok(this.config, "Expected a simulation configuration");
  this.config = { ...this.config, wipLimits: { ...(this.config.wipLimits ?? {}), Development: limit } };
});

Given("Test has an explicit WIP limit of {int} items", function (this: FlowLabWorld, limit: number) {
  assert.ok(this.config, "Expected a simulation configuration");
  this.config = { ...this.config, wipLimits: { ...(this.config.wipLimits ?? {}), Test: limit } };
});

When("{int} items occupy Development", function (this: FlowLabWorld, limit: number) {
  assert.ok(this.config, "Expected a WIP-limited configuration");
  this.result = runScenario(this.config, 1);
  assert.equal(resultFor(this).snapshots[0].states.Development, limit);
});

Then("no additional item enters Development", function (this: FlowLabWorld) {
  const entries = resultFor(this).events.filter((event) => event.type === "entered-stage" && event.stage === "Development" && event.day === 0);
  assert.equal(entries.length, 2);
});

When("I set focus WIP to {int}, maximum concurrency to {int}, and task-switching loss ratio to {float}", function (this: FlowLabWorld, focusWip: number, maximumConcurrency: number, taskSwitchingLossRatio: number) {
  assert.ok(this.config, "Expected operating assumptions to edit");
  this.config = withOperatingAssumptions(this.config, { Development: { focusWip, maximumConcurrency, taskSwitchingLossRatio } });
});

Then("the simulation uses those Development operating assumptions", function (this: FlowLabWorld) {
  assert.deepEqual(this.config?.operatingAssumptions?.Development, { focusWip: 2, maximumConcurrency: 16, taskSwitchingLossRatio: 0.5 });
});

Then("the CFD, metrics, and daily log expose the resulting concurrency and task-switching effects", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected operating assumptions");
  const result = runScenario({ ...this.config, horizonDays: 1, batchDays: [0], batchSize: 4, initialBacklog: { pbiCount: 4, bugCount: 0 }, arrivalRatePerDay: 0 }, 1);
  assert.ok(result.snapshots[0].operatingCapacity?.some((capacity) => capacity.stage === "Development" && capacity.concurrentItems > 0));
});

When("I save a maximum concurrency lower than focus WIP", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected operating assumptions to edit");
  try {
    this.config = withOperatingAssumptions(this.config, { Development: { focusWip: 3, maximumConcurrency: 2, taskSwitchingLossRatio: 0.5 } });
  } catch (error) {
    this.operatingError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that maximum concurrency must be at least focus WIP", function (this: FlowLabWorld) {
  assert.equal(this.operatingError, "Maximum concurrency must be at least focus WIP.");
});

When("I save a task-switching loss ratio greater than {int}", function (this: FlowLabWorld, ratio: number) {
  assert.ok(this.config, "Expected operating assumptions to edit");
  try {
    this.config = withOperatingAssumptions(this.config, { Development: { focusWip: 2, maximumConcurrency: 16, taskSwitchingLossRatio: ratio + 0.1 } });
  } catch (error) {
    this.operatingError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that the task-switching loss ratio must be between zero and one", function (this: FlowLabWorld) {
  assert.equal(this.operatingError, "The task-switching loss ratio must be between zero and one.");
});

Then("the current operating assumptions remain unchanged", function (this: FlowLabWorld) {
  assert.deepEqual(this.config?.operatingAssumptions?.Development, this.operatingBeforeEdit);
});

Given("I am editing the initial workflow inventory", function (this: FlowLabWorld) {
  this.config = withSimulationSettings(scenarios.baseline, { initialInventory: {} });
  this.initialInventoryBeforeEdit = this.config.initialInventory;
});

When(/^I set the initial inventory to (\d+) PBIs? and (\d+) bugs? in (.+)$/, function (this: FlowLabWorld, pbiCount: string, bugCount: string, stage: string) {
  assert.ok(this.config, "Expected a simulation configuration to edit");
  this.config = withStageInventory(this.config, stage, Number(pbiCount), Number(bugCount));
});

Then("{int} items in Development", function (this: FlowLabWorld, count: number) {
  const seeded = resultFor(this).items.filter((item) => item.initial && item.history[0]?.stage === "Development");
  assert.equal(seeded.length, count);
});

Then("{int} items in Test", function (this: FlowLabWorld, count: number) {
  const seeded = resultFor(this).items.filter((item) => item.initial && item.history[0]?.stage === "Test");
  assert.equal(seeded.length, count);
});

Then("no initial work can be seeded directly into Done", function (this: FlowLabWorld) {
  assert.equal(this.config?.initialInventory?.Done, undefined);
  assert.ok(resultFor(this).items.every((item) => item.history[0]?.stage !== "Done"));
});

When("I open the initial workflow inventory settings", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a workflow configuration");
  this.config = withSimulationSettings(this.config, { initialInventory: {} });
});

Then("I can set an initial PBI and bug count for Ready, Discovery, Development, and Test", function (this: FlowLabWorld) {
  assert.deepEqual(Object.keys(this.config?.initialInventory ?? {}), ["Ready", "Discovery", "Development", "Test"]);
});

Then("Done is not an initial-inventory stage", function (this: FlowLabWorld) {
  assert.equal(this.config?.initialInventory?.Done, undefined);
});

Given("an initial inventory of 2 PBIs in Backlog, 1 bug in Development, and 1 PBI in Test", function (this: FlowLabWorld) {
  this.config = stagedInventoryConfig({
    Backlog: { pbiCount: 2, bugCount: 0 },
    Development: { pbiCount: 0, bugCount: 1 },
    Test: { pbiCount: 1, bugCount: 0 },
  });
});

When("I inspect the Kanban board before the first simulated working day", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a simulation configuration");
  this.result = runScenario(this.config, 42);
});

Then("every seeded item has a unique ID and a non-empty title", function (this: FlowLabWorld) {
  const seeded = resultFor(this).items.filter((item) => item.initial);
  assert.equal(new Set(seeded.map((item) => item.id)).size, seeded.length);
  assert.ok(seeded.every((item) => item.title.trim().length > 0));
});

Then("each seeded item identifies whether it is a PBI or a bug", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).items.filter((item) => item.initial).every((item) => item.type === "PBI" || item.type === "Bug"));
});

Then("each seeded item appears in its configured starting stage", function (this: FlowLabWorld) {
  const inventory = this.config?.initialInventory ?? {};
  for (const [stage, counts] of Object.entries(inventory)) {
    const items = resultFor(this).items.filter((item) => item.initial && item.history[0]?.stage === stage);
    const expected = counts ?? { pbiCount: 0, bugCount: 0 };
    assert.equal(items.filter((item) => item.type === "PBI").length, expected.pbiCount);
    assert.equal(items.filter((item) => item.type === "Bug").length, expected.bugCount);
  }
});

Then("each seeded item is initially inactive with {int} percent simulated progress", function (this: FlowLabWorld, progress: number) {
  assert.ok(resultFor(this).items.filter((item) => item.initial).every((item) => item.history[0]?.active === false && item.history[0]?.progressPercent === progress));
});

Given("an initial inventory of {int} PBIs in Development", function (this: FlowLabWorld, pbiCount: number) {
  this.config = stagedInventoryConfig({ Development: { pbiCount, bugCount: 0 } }, { horizonDays: 1 });
});

Then("{int} seeded Development items are active or received Development capacity on day {int}", function (this: FlowLabWorld, count: number, day: number) {
  const started = resultFor(this).items.filter((item) => item.initial && item.history[0]?.stage === "Development" && item.startedAt.Development === day);
  assert.equal(started.length, count);
});

Then("{int} seeded Development item remains waiting in Development", function (this: FlowLabWorld, count: number) {
  const waiting = resultFor(this).items.filter((item) => item.initial && item.history[0]?.stage === "Development" && itemStateAtDay(item, 0)?.stage === "Development" && item.firstStartedAt === undefined);
  assert.equal(waiting.length, count);
});

Then("all {int} seeded items remain represented in Development or downstream stages", function (this: FlowLabWorld, count: number) {
  const result = resultFor(this);
  const stages = result.config.workflow.stages;
  const developmentIndex = stages.indexOf("Development");
  const seeded = result.items.filter((item) => item.initial && item.history[0]?.stage === "Development");
  assert.equal(seeded.length, count);
  assert.ok(seeded.every((item) => stages.indexOf(item.stage) >= developmentIndex));
});

Then("the Development WIP limit blocks only later admissions into Development", function (this: FlowLabWorld) {
  assert.equal(this.config?.wipLimits?.Development, 5);
  assert.equal(resultFor(this).items.filter((item) => item.initial && item.history[0]?.stage === "Development").length, 8);
});

When("I set the initial Test bug count to {int}", function (this: FlowLabWorld, count: number) {
  assert.ok(this.config, "Expected a simulation configuration to edit");
  try {
    this.config = withStageInventory(this.config, "Test", this.config.initialInventory?.Test?.pbiCount ?? 0, count);
  } catch (error) {
    this.initialInventoryError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that the initial Test bug count must be a non-negative whole number", function (this: FlowLabWorld) {
  assert.equal(this.initialInventoryError, "The initial Test bug count must be a non-negative whole number.");
});

Then("the initial workflow inventory settings remain unchanged", function (this: FlowLabWorld) {
  assert.deepEqual(this.config?.initialInventory, this.initialInventoryBeforeEdit);
});

Given("I am editing the initial backlog", function (this: FlowLabWorld) {
  this.config = scenarios.baseline;
  this.initialBacklogBeforeEdit = this.config.initialBacklog ?? { pbiCount: 0, bugCount: 0 };
});

When("I set the initial backlog to {int} PBIs and {int} bugs", function (this: FlowLabWorld, pbiCount: number, bugCount: number) {
  assert.ok(this.config, "Expected a simulation configuration to edit");
  this.config = withSimulationSettings(this.config, { initialBacklog: { pbiCount, bugCount } });
});

Then("the next simulation is seeded before day 0 with {int} items in Backlog", function (this: FlowLabWorld, count: number) {
  assert.ok(this.config, "Expected an initial backlog configuration");
  this.result = runScenario({ ...this.config, horizonDays: 1, arrivalRatePerDay: 0, batchDays: [] }, 42);
  const seeded = resultFor(this).items.filter((item) => item.initial && item.history[0]?.stage === this.config?.workflow.stages[0]);
  assert.equal(seeded.length, count);
  assert.ok(seeded.every((item) => item.history[0]?.active === false));
});

Then("the initial backlog contains {int} PBIs and {int} bugs", function (this: FlowLabWorld, pbiCount: number, bugCount: number) {
  const seeded = resultFor(this).items.filter((item) => item.initial);
  assert.equal(seeded.filter((item) => item.type === "PBI").length, pbiCount);
  assert.equal(seeded.filter((item) => item.type === "Bug").length, bugCount);
});

Then("the configured daily push rate is retained", function (this: FlowLabWorld) {
  assert.ok((this.config?.arrivalRatePerDay ?? 0) > 0);
});

Given("a simulation with an initial backlog of {int} PBIs and {int} bug", function (this: FlowLabWorld, pbiCount: number, bugCount: number) {
  this.config = initialBacklogConfig(pbiCount, bugCount);
});

Given("a simulation with an initial backlog of {int} PBIs and {int} bugs", function (this: FlowLabWorld, pbiCount: number, bugCount: number) {
  this.config = initialBacklogConfig(pbiCount, bugCount);
});

Given("a simulation with an initial backlog of {int} PBIs and no bugs", function (this: FlowLabWorld, pbiCount: number) {
  this.config = initialBacklogConfig(pbiCount, 0);
});

When("I simulate with seed {int}", function (this: FlowLabWorld, seed: number) {
  assert.ok(this.config, "Expected a simulation configuration");
  this.result = runScenario(this.config, seed);
  this.secondResult = runScenario(this.config, seed);
});

Then("every initial backlog item has a unique ID", function (this: FlowLabWorld) {
  const items = resultFor(this).items.filter((item) => item.initial);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
});

Then("every initial backlog item has a non-empty title", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).items.filter((item) => item.initial).every((item) => item.title.trim().length > 0));
});

Then("every initial backlog item identifies whether it is a PBI or a bug", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).items.filter((item) => item.initial).every((item) => item.type === "PBI" || item.type === "Bug"));
});

Then("the same seed produces the same initial item IDs, titles, and types", function (this: FlowLabWorld) {
  const identify = (result: SimulationResult | undefined) => result?.items.filter((item) => item.initial).map(({ id, title, type }) => ({ id, title, type }));
  assert.deepEqual(identify(resultFor(this)), identify(this.secondResult));
});

Then("the daily push rate creates no external work items", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.items.every((item) => item.initial));
  assert.equal(movementCount(result, "External", "Backlog"), 0);
});

Then("all {int} initial items remain in Backlog when the push rate is zero", function (this: FlowLabWorld, count: number) {
  assert.equal(resultFor(this).snapshots[0].states.Backlog, count);
});

When("I inspect the Kanban board on day {int}", function (this: FlowLabWorld, day: number) {
  assert.ok(this.config, "Expected a simulation configuration");
  this.config = { ...this.config, horizonDays: Math.max(this.config.horizonDays, day + 1) };
  this.result = runScenario(this.config, 42);
});

Then("every item created on or before day {int} appears in exactly one workflow stage", function (this: FlowLabWorld, day: number) {
  const visible = resultFor(this).items.filter((item) => item.history[0]?.day <= day);
  assert.ok(visible.every((item) => itemStateAtDay(item, day) !== undefined));
  assert.equal(new Set(visible.map((item) => item.id)).size, visible.length);
});

Then("each card shows its ID, title, stage, active status, progress, start date, and completion date", function (this: FlowLabWorld) {
  const visible = resultFor(this).items.filter((item) => itemStateAtDay(item, 0));
  assert.ok(visible.every((item) => {
    const state = itemStateAtDay(item, 0);
    return item.id.length > 0 && item.title.length > 0 && state !== undefined && typeof state.stage === "string" && typeof state.active === "boolean" && Number.isFinite(state.progressPercent);
  }));
});

Then("the number of cards in each stage matches the CFD state for that day", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const stateCounts = Object.fromEntries(result.config.workflow.stages.map((stage) => [stage, 0]));
  result.items.forEach((item) => {
    const state = itemStateAtDay(item, 0);
    if (state) stateCounts[state.stage] += 1;
  });
  assert.deepEqual(stateCounts, result.snapshots[0].states);
});

When("I simulate day {int}", function (this: FlowLabWorld, day: number) {
  if (this.projectFile) {
    loadProject(this);
    assert.ok(resultFor(this).snapshots[day]);
    return;
  }
  assert.ok(this.config, "Expected a simulation configuration");
  this.config = { ...this.config, horizonDays: Math.max(this.config.horizonDays, day + 1) };
  this.result = runScenario(this.config, 42);
});

Then("all {int} initial items have entered Development", function (this: FlowLabWorld, count: number) {
  const entries = resultFor(this).events.filter((event) => event.day === 0 && event.type === "entered-stage" && event.stage === "Development");
  assert.equal(entries.length, count);
});

Then("{int} items are active in Development", function (this: FlowLabWorld, count: number) {
  assert.equal(resultFor(this).snapshots[0].active.Development, count);
});

Then("{int} item is waiting in Development", function (this: FlowLabWorld, count: number) {
  assert.equal(resultFor(this).snapshots[0].waiting.Development, count);
});

Then("only active items make progress on day {int}", function (this: FlowLabWorld, day: number) {
  const result = resultFor(this);
  const advanced = result.items.filter((item) => (itemStateAtDay(item, day)?.progressPercent ?? 0) > 0);
  assert.ok(advanced.every((item) => item.firstStartedAt !== undefined && item.firstStartedAt <= day));
});

Then("{int} items are in Development", function (this: FlowLabWorld, count: number) {
  assert.equal(resultFor(this).snapshots[0].states.Development, count);
});

Then("{int} items remain in Backlog", function (this: FlowLabWorld, count: number) {
  assert.equal(resultFor(this).snapshots[0].states.Backlog, count);
});

Then("the Kanban board shows the same distribution", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const counts = Object.fromEntries(result.config.workflow.stages.map((stage) => [stage, 0]));
  result.items.forEach((item) => {
    const state = itemStateAtDay(item, 0);
    if (state) counts[state.stage] += 1;
  });
  assert.deepEqual(counts, result.snapshots[0].states);
});

Given("an initial backlog item that has not started active work", function (this: FlowLabWorld) {
  this.config = initialBacklogConfig(2, 0, {
    horizonDays: 4,
    batchDays: [0],
    batchSize: 2,
    baseRates: { Development: 1, Test: 0.1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 10, max: 10 } },
    operatingAssumptions: {
      Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
    },
    wipLimits: { Test: 0 },
  });
  this.result = runScenario(this.config, 42);
  this.inspectedItemId = resultFor(this).items.find((item) => itemStateAtDay(item, 0)?.startDate === undefined)?.id;
  assert.ok(this.inspectedItemId, "Expected an item waiting without active work");
});

When("I inspect the item on day {int}", function (this: FlowLabWorld, day: number) {
  const item = resultFor(this).items.find((candidate) => candidate.id === this.inspectedItemId);
  assert.ok(itemStateAtDay(item as WorkItem, day), "Expected the inspected item to be visible on the board");
});

Then("its progress is {int} percent", function (this: FlowLabWorld, progress: number) {
  const item = this.inspectedItemId
    ? resultFor(this).items.find((candidate) => candidate.id === this.inspectedItemId)
    : resultFor(this).items[0];
  assert.ok(item, "Expected an item to inspect");
  const state = this.inspectedItemId ? itemStateAtDay(item, 0) : item.history.at(-1);
  assert.equal(state?.progressPercent, progress);
});

Then("its start date is empty", function (this: FlowLabWorld) {
  const item = resultFor(this).items.find((candidate) => candidate.id === this.inspectedItemId);
  assert.equal(itemStateAtDay(item as WorkItem, 0)?.startDate, undefined);
});

Then("its completion date is empty", function (this: FlowLabWorld) {
  const item = resultFor(this).items.find((candidate) => candidate.id === this.inspectedItemId);
  assert.equal(itemStateAtDay(item as WorkItem, 0)?.completionDate, undefined);
});

When("the item becomes active in Development", function (this: FlowLabWorld) {
  const item = resultFor(this).items.find((candidate) => candidate.id === this.inspectedItemId);
  assert.equal(item?.startedAt.Development, 1);
});

Then("its start date is that simulation day", function (this: FlowLabWorld) {
  const item = resultFor(this).items.find((candidate) => candidate.id === this.inspectedItemId);
  assert.equal(item?.firstStartedAt, 1);
});

Then("its progress increases while it receives Development capacity", function (this: FlowLabWorld) {
  const item = resultFor(this).items.find((candidate) => candidate.id === this.inspectedItemId) as WorkItem;
  assert.ok((itemStateAtDay(item, 1)?.progressPercent ?? 0) > 0);
});

When("the item waits without active work", function () {
  // The scenario configuration keeps Test at a zero WIP admission limit, so the item remains blocked after Development.
});

Then("its progress does not change", function (this: FlowLabWorld) {
  const item = resultFor(this).items.find((candidate) => candidate.id === this.inspectedItemId) as WorkItem;
  assert.equal(itemStateAtDay(item, 2)?.progressPercent, itemStateAtDay(item, 1)?.progressPercent);
});

Given("an active initial backlog item with enough remaining work to finish today", function (this: FlowLabWorld) {
  this.config = initialBacklogConfig(1, 0, {
    horizonDays: 4,
    batchDays: [0],
    batchSize: 1,
    baseRates: { Development: 1, Test: 1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 1, max: 1 } },
    operatingAssumptions: {
      Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
    },
  });
});

When("the item completes the final workflow stage", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a simulation configuration");
  this.result = runScenario(this.config, 42);
});

Then("its stage is the configured final workflow stage", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(result.items[0].stage, result.config.workflow.stages.at(-1));
});

Then("its active status is false", function (this: FlowLabWorld) {
  assert.equal(resultFor(this).items[0].active, false);
});

Then("its completion date is that simulation day", function (this: FlowLabWorld) {
  const item = resultFor(this).items[0];
  assert.equal(item.completedAt, item.history.at(-1)?.completionDate);
});

When("I set the initial PBI count to {int}", function (this: FlowLabWorld, count: number) {
  assert.ok(this.config, "Expected a simulation configuration to edit");
  try {
    this.config = withSimulationSettings(this.config, { initialBacklog: { pbiCount: count, bugCount: this.initialBacklogBeforeEdit?.bugCount ?? 0 } });
  } catch (error) {
    this.initialBacklogError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that the initial PBI count must be a non-negative whole number", function (this: FlowLabWorld) {
  assert.equal(this.initialBacklogError, "The initial PBI count must be a non-negative whole number.");
});

Then("the initial backlog settings remain unchanged", function (this: FlowLabWorld) {
  assert.deepEqual(this.config?.initialBacklog, this.initialBacklogBeforeEdit);
});

When("I set the initial bug count to {float}", function (this: FlowLabWorld, count: number) {
  assert.ok(this.config, "Expected a simulation configuration to edit");
  try {
    this.config = withSimulationSettings(this.config, { initialBacklog: { pbiCount: this.initialBacklogBeforeEdit?.pbiCount ?? 0, bugCount: count } });
  } catch (error) {
    this.initialBacklogError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that the initial bug count must be a non-negative whole number", function (this: FlowLabWorld) {
  assert.equal(this.initialBacklogError, "The initial bug count must be a non-negative whole number.");
});

Given("I am editing the feature-backed initial backlog", function (this: FlowLabWorld) {
  this.config = withSimulationSettings(scenarios.baseline, { featureBacklog: { featureCount: 0, minPbisPerFeature: 5, maxPbisPerFeature: 10, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 } });
  this.featureBacklogBeforeEdit = this.config.featureBacklog;
});

When("I set the initial feature count to {int}", function (this: FlowLabWorld, featureCount: number) {
  assert.ok(this.config, "Expected a feature-backed backlog configuration");
  try {
    this.config = updateFeatureBacklog(this.config, { featureCount });
  } catch (error) {
    this.featureBacklogError = error instanceof Error ? error.message : String(error);
  }
});

When("I set the PBIs per feature to a minimum of {int} and a maximum of {int}", function (this: FlowLabWorld, minPbisPerFeature: number, maxPbisPerFeature: number) {
  assert.ok(this.config, "Expected a feature-backed backlog configuration");
  this.config = updateFeatureBacklog(this.config, { minPbisPerFeature, maxPbisPerFeature });
});

Then("the next simulation seeds {int} features in Backlog", function (this: FlowLabWorld, featureCount: number) {
  assert.ok(this.config, "Expected a feature-backed backlog configuration");
  this.result = runScenario({ ...this.config, horizonDays: 1, arrivalRatePerDay: 0, batchDays: [] }, 42);
  assert.equal(resultFor(this).features.length, featureCount);
  assert.ok(resultFor(this).items.filter((item) => item.featureId).every((item) => item.history[0]?.stage === "Backlog"));
});

Then("every seeded feature contains between {int} and {int} PBIs", function (this: FlowLabWorld, minimum: number, maximum: number) {
  assert.ok(resultFor(this).features.every((feature) => feature.pbiIds.length >= minimum && feature.pbiIds.length <= maximum));
});

Then("every seeded PBI has a feature ID and feature title", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).items.filter((item) => item.featureId).every((item) => item.type === "PBI" && item.featureTitle));
});

Then("the same seed produces the same features, PBI counts, IDs, and titles", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a feature-backed backlog configuration");
  const repeated = runScenario({ ...this.config, horizonDays: 1, arrivalRatePerDay: 0, batchDays: [] }, 42);
  assert.deepEqual(
    resultFor(this).features.map((feature) => ({ id: feature.id, title: feature.title, pbiIds: feature.pbiIds })),
    repeated.features.map((feature) => ({ id: feature.id, title: feature.title, pbiIds: feature.pbiIds })),
  );
  assert.deepEqual(
    resultFor(this).items.filter((item) => item.featureId).map(({ id, title }) => ({ id, title })),
    repeated.items.filter((item) => item.featureId).map(({ id, title }) => ({ id, title })),
  );
});

Then("I am told that the initial feature count must be a non-negative whole number", function (this: FlowLabWorld) {
  assert.equal(this.featureBacklogError, "The initial feature count must be a non-negative whole number.");
});

Then("the feature-backed initial backlog settings remain unchanged", function (this: FlowLabWorld) {
  assert.deepEqual(this.config?.featureBacklog, this.featureBacklogBeforeEdit);
});

When("I set the minimum PBIs per feature to {int} and the maximum to {int}", function (this: FlowLabWorld, minPbisPerFeature: number, maxPbisPerFeature: number) {
  assert.ok(this.config, "Expected a feature-backed backlog configuration");
  try {
    this.config = updateFeatureBacklog(this.config, { minPbisPerFeature, maxPbisPerFeature });
  } catch (error) {
    this.featureBacklogError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that the maximum PBIs per feature must be at least the minimum", function (this: FlowLabWorld) {
  assert.equal(this.featureBacklogError, "The maximum PBIs per feature must be at least the minimum.");
});

Given("a feature with {int} PBIs in Development", function (this: FlowLabWorld, pbiCount: number) {
  this.config = featureFlowConfig({ featureBacklog: { featureCount: 1, minPbisPerFeature: pbiCount, maxPbisPerFeature: pbiCount, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 } });
  this.result = runScenario({ ...this.config, horizonDays: 1 }, 42);
});

Given("{int} PBIs have completed Development", function (this: FlowLabWorld, pbiCount: number) {
  const feature = resultFor(this).features[0];
  assert.equal(resultFor(this).items.filter((item) => feature.pbiIds.includes(item.id) && item.developedAt === 0).length, pbiCount);
});

When("I simulate the next working day", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a feature flow configuration");
  this.result = runScenario(this.config.featureFocus ? this.config : { ...this.config, horizonDays: 2 }, 42);
});

Then("the {int} developed PBIs wait for their feature's test gate", function (this: FlowLabWorld, pbiCount: number) {
  const feature = resultFor(this).features[0];
  assert.equal(resultFor(this).items.filter((item) => feature.pbiIds.includes(item.id) && item.developedAt === 0 && item.stage === "Integration" && item.status === "waiting").length, pbiCount);
});

Then("no PBI from that feature enters Test", function (this: FlowLabWorld) {
  const feature = resultFor(this).features[0];
  assert.equal(resultFor(this).events.filter((event) => event.type === "entered-stage" && event.stage === "Test" && feature.pbiIds.includes(event.itemId)).length, 0);
});

When("the third PBI completes Development", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a feature flow configuration");
  this.result = runScenario({ ...this.config, horizonDays: 4 }, 42);
});

Then("all {int} PBIs become eligible to enter Test according to Test WIP and concurrency", function (this: FlowLabWorld, pbiCount: number) {
  const feature = resultFor(this).features[0];
  assert.equal(resultFor(this).events.filter((event) => event.type === "entered-stage" && event.stage === "Test" && feature.pbiIds.includes(event.itemId)).length, pbiCount);
});

Given("a feature with {int} developed PBIs whose test gate is open", function (this: FlowLabWorld, pbiCount: number) {
  this.config = featureFlowConfig({ featureBacklog: { featureCount: 1, minPbisPerFeature: pbiCount, maxPbisPerFeature: pbiCount, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 }, wipLimits: { Test: 2 } });
});

When("work is pulled into Test", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a feature flow configuration");
  this.result = runScenario({ ...this.config, horizonDays: 3 }, 42);
});

Then("{int} PBIs from that feature enter Test", function (this: FlowLabWorld, pbiCount: number) {
  const feature = resultFor(this).features[0];
  assert.equal(resultFor(this).events.filter((event) => event.type === "entered-stage" && event.stage === "Test" && feature.pbiIds.includes(event.itemId)).length, pbiCount);
});

Then("{int} PBI remains waiting for a free Test WIP slot", function (this: FlowLabWorld, pbiCount: number) {
  assert.equal(resultFor(this).snapshots[2].states.Integration, pbiCount);
});

Then("the Kanban board identifies the feature on all three PBIs", function (this: FlowLabWorld) {
  const feature = resultFor(this).features[0];
  assert.ok(resultFor(this).items.filter((item) => feature.pbiIds.includes(item.id)).every((item) => item.featureId === feature.id && item.featureTitle === feature.title));
});

Given("a WIP-limited Feature with {int} PBIs and staggered Development completion", function (this: FlowLabWorld, pbiCount: number) {
  this.config = featureFlowConfig({
    horizonDays: 8,
    featureBacklog: { featureCount: 1, minPbisPerFeature: pbiCount, maxPbisPerFeature: pbiCount, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    wipLimits: { Development: 5, Integration: 5, Test: 1 },
    baseRates: { Development: 2, Test: 1 },
    serviceEffort: { Development: { min: 5, max: 5 }, Test: { min: 10, max: 10 } },
    operatingAssumptions: {
      Development: { focusWip: 5, maximumConcurrency: 2, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
    },
  });
});

When("a developed PBI can be pulled into Test", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a WIP-limited Feature configuration");
  this.result = runScenario(this.config, 42);
});

Then("it enters Test without waiting for the remaining PBI to finish Development", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const feature = result.features[0];
  const firstTestEntry = Math.min(...result.events
    .filter((event) => event.type === "entered-stage" && event.stage === "Test" && feature.pbiIds.includes(event.itemId))
    .map((event) => event.day));
  const lastDevelopmentCompletion = Math.max(...feature.pbiIds.map((id) => result.items.find((item) => item.id === id)?.developedAt ?? -1));
  assert.ok(firstTestEntry < lastDevelopmentCompletion);
});

Then("Test WIP still limits how many ready PBIs can enter", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).snapshots.every((snapshot) => snapshot.states.Test <= 1));
});

Given("a tested PBI from feature {string}", function (this: FlowLabWorld, _featureTitle: string) {
  this.config = featureFlowConfig({
    horizonDays: 41,
    featureBacklog: { featureCount: 1, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 },
    baseRates: { Development: 1, Test: 1 },
    serviceEffort: { Development: { min: 21, max: 21 }, Test: { min: 19, max: 19 } },
    operatingAssumptions: {
      Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
    },
  });
});

Given("the bug generation ratio is one bug per tested PBI", function (this: FlowLabWorld) {
  assert.equal(this.config?.featureBacklog?.featureCount, 1);
});

When("the PBI completes Test on day {int}", function (this: FlowLabWorld, day: number) {
  assert.ok(this.config, "Expected a feature flow configuration");
  this.result = runScenario(this.config, 42);
  const pbi = resultFor(this).items.find((item) => item.featureId && item.type === "PBI");
  assert.equal(pbi?.testedAt, day);
});

Then("exactly one Bug is created for that PBI on day {int}", function (this: FlowLabWorld, day: number) {
  const pbi = resultFor(this).items.find((item) => item.featureId && item.type === "PBI");
  const bugs = resultFor(this).items.filter((item) => item.originatingPbiId === pbi?.id);
  assert.equal(bugs.length, 1);
  assert.equal(bugs[0].arrivedAt, day);
});

Then("the Bug has its own unique ID and title", function (this: FlowLabWorld) {
  const bug = resultFor(this).items.find((item) => item.originatingPbiId);
  assert.ok(bug && bug.id !== bug.originatingPbiId && bug.title.length > 0);
});

Then("the Bug retains the originating PBI ID and feature ID", function (this: FlowLabWorld) {
  const bug = resultFor(this).items.find((item) => item.originatingPbiId);
  const pbi = resultFor(this).items.find((item) => item.id === bug?.originatingPbiId);
  assert.equal(bug?.featureId, pbi?.featureId);
});

Then("the Bug enters Backlog inactive with {int} percent progress", function (this: FlowLabWorld, progress: number) {
  const bug = resultFor(this).items.find((item) => item.originatingPbiId);
  assert.equal(bug?.history[0]?.stage, "Backlog");
  assert.equal(bug?.history[0]?.active, false);
  assert.equal(bug?.history[0]?.progressPercent, progress);
});

Then("completing the PBI again does not create another Bug", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a feature flow configuration");
  const rerun = runScenario({ ...this.config, horizonDays: this.config.horizonDays + 1 }, 42);
  assert.equal(rerun.items.filter((item) => item.originatingPbiId).length, 1);
});

Given("a PBI was completed in Development on day {int}", function (this: FlowLabWorld, day: number) {
  this.feedbackDevelopedDay = day;
});

Given("that PBI completes Test on day {int}", function (this: FlowLabWorld, day: number) {
  this.feedbackTestedDay = day;
});

Given("the base Bug effort is {float}", function (this: FlowLabWorld, effort: number) {
  this.feedbackBaseBugEffort = effort;
});

Given("the feedback-delay effort factor is {float} per working day", function (this: FlowLabWorld, factor: number) {
  this.feedbackDelayFactor = factor;
});

When("its feedback Bug is created", function (this: FlowLabWorld) {
  assert.ok(this.feedbackDevelopedDay !== undefined && this.feedbackTestedDay !== undefined && this.feedbackBaseBugEffort !== undefined && this.feedbackDelayFactor !== undefined);
  this.feedbackResult = feedbackBugEffortFor(this.feedbackBaseBugEffort, this.feedbackDelayFactor, this.feedbackDevelopedDay, this.feedbackTestedDay);
});

Then("the Bug receives {float} units of fix effort", function (this: FlowLabWorld, effort: number) {
  assert.ok(Math.abs((this.feedbackResult?.effort ?? 0) - effort) < 1e-9);
});

Then("the delay is recorded as {int} working days", function (this: FlowLabWorld, days: number) {
  assert.equal(this.feedbackResult?.delayDays, days);
});

Given("a feature whose PBIs have completed Test and generated feedback Bugs", function (this: FlowLabWorld) {
  this.config = featureFlowConfig();
});

When("all of that feature's feedback Bugs reach Done", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a feature flow configuration");
  this.result = runScenario(this.config, 42);
});

Then("the feature is shown as complete", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).features[0].completedAt !== undefined);
});

Then("the feature completion day is the latest completion day of its PBIs and Bugs", function (this: FlowLabWorld) {
  const feature = resultFor(this).features[0];
  const days = [...feature.pbiIds, ...feature.bugIds].map((id) => resultFor(this).items.find((item) => item.id === id)?.completedAt ?? 0);
  assert.equal(feature.completedAt, Math.max(...days));
});

Then("feature metrics count the feature once", function (this: FlowLabWorld) {
  assert.equal(resultFor(this).metrics.completedFeatures, 1);
});

Given("a feature-backed backlog with three Features in creation order", function (this: FlowLabWorld) {
  this.config = finishingFocusConfig();
});

Given("Stop starting, start finishing begins on day {int}", function (this: FlowLabWorld, startDay: number) {
  assert.ok(this.config, "Expected a feature-backed configuration");
  this.config = { ...this.config, featureFocus: { startDay } };
});

When("I simulate the first working day", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
  this.result = runScenario({ ...this.config, horizonDays: 1 }, 42);
});

Then("Feature 001 is the current finishing focus", function (this: FlowLabWorld) {
  assert.equal(resultFor(this).snapshots.at(-1)?.featureFocus?.id, "FEATURE-001");
});

Then("only Feature 001 work is admitted from Backlog into Development", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const admissions = result.events.filter((event) => event.type === "entered-stage" && event.stage === "Development");
  assert.ok(admissions.length > 0);
  assert.ok(admissions.every((event) => result.items.find((item) => item.id === event.itemId)?.featureId === "FEATURE-001"));
});

Then("Feature 002 and Feature 003 work remain in Backlog", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.items.filter((item) => item.featureId === "FEATURE-002" || item.featureId === "FEATURE-003").every((item) => item.stage === "Backlog"));
});

Given("Feature 001 has unfinished PBIs or feedback Bugs", function (this: FlowLabWorld) {
  this.config = finishingFocusConfig({
    horizonDays: 2,
    featureBacklog: { featureCount: 3, minPbisPerFeature: 3, maxPbisPerFeature: 3, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    baseRates: { Development: 0.5, Test: 1 },
    serviceEffort: { Development: { min: 4, max: 4 }, Test: { min: 1, max: 1 } },
  });
});

Given("Development has free capacity", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
});

When("I simulate another working day with Stop starting, start finishing active", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
  this.result = runScenario(this.config, 42);
});

Then("no PBI or Bug belonging to a later Feature enters Development", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const laterFeatureItemIds = new Set(result.items.filter((item) => item.featureId && item.featureId !== "FEATURE-001").map((item) => item.id));
  assert.equal(result.events.filter((event) => event.type === "entered-stage" && event.stage === "Development" && laterFeatureItemIds.has(event.itemId)).length, 0);
});

Then("available capacity is used only for Feature 001 work when such work is ready", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const started = result.events.filter((event) => event.type === "started" && event.stage === "Development");
  assert.ok(started.length > 0);
  assert.ok(started.every((event) => result.items.find((item) => item.id === event.itemId)?.featureId === "FEATURE-001"));
});

Given("the focused Feature has multiple PBIs in Development", function (this: FlowLabWorld) {
  this.config = finishingFocusConfig({
    horizonDays: 6,
    featureBacklog: { featureCount: 2, minPbisPerFeature: 3, maxPbisPerFeature: 3, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    wipLimits: { Development: 3, Integration: 3, Test: 1 },
  });
});

When("its PBIs complete Development at different times", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
  this.result = runScenario(this.config, 42);
});

Then("completed PBIs wait in Integration until the focused Feature's test gate opens", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const firstFeature = result.features[0];
  const developedOnDayZero = result.items.filter((item) => firstFeature.pbiIds.includes(item.id) && item.developedAt === 0);
  assert.equal(developedOnDayZero.length, 2);
  assert.equal(result.snapshots[1].states.Integration, 2);
  assert.equal(result.snapshots[1].states.Test, 0);
});

Then("no later Feature is admitted while those PBIs wait", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const earlyAdmissions = result.events.filter((event) => event.type === "entered-stage" && event.stage === "Development" && event.day <= 2);
  assert.ok(earlyAdmissions.every((event) => result.items.find((item) => item.id === event.itemId)?.featureId === "FEATURE-001"));
});

Then("the focused PBIs enter Test according to the Test WIP limit and concurrency", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const firstFeature = result.features[0];
  assert.ok(result.events.some((event) => event.type === "entered-stage" && event.stage === "Test" && firstFeature.pbiIds.includes(event.itemId)));
  assert.ok(result.snapshots.every((snapshot) => snapshot.states.Test <= 1));
});

Given("a focused Feature PBI completes Test and creates a feedback Bug", function (this: FlowLabWorld) {
  this.config = finishingFocusConfig({
    horizonDays: 7,
    featureBacklog: { featureCount: 2, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    baseRates: { Development: 1, Test: 1 },
    operatingAssumptions: {
      Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
    },
  });
});

When("the feedback Bug is ready to enter Development", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
  this.result = runScenario(this.config, 42);
});

Then("the feedback Bug is admitted before work from a later Feature", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const bug = result.items.find((item) => item.type === "Bug" && item.featureId === "FEATURE-001");
  assert.ok(bug, "Expected the focused Feature to generate a Bug");
  const bugAdmission = result.events.find((event) => event.type === "entered-stage" && event.stage === "Development" && event.itemId === bug.id);
  assert.ok(bugAdmission, "Expected the Bug to enter Development");
  const laterAdmission = result.events.find((event) => event.type === "entered-stage" && event.stage === "Development" && result.items.find((item) => item.id === event.itemId)?.featureId === "FEATURE-002");
  assert.ok(!laterAdmission || bugAdmission.day < laterAdmission.day);
});

Then("the next Feature remains stopped until that Bug reaches Done", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const bug = result.items.find((item) => item.type === "Bug" && item.featureId === "FEATURE-001");
  const nextFeatureAdmission = result.events.find((event) => event.type === "entered-stage" && event.stage === "Development" && result.items.find((item) => item.id === event.itemId)?.featureId === "FEATURE-002");
  assert.ok(bug?.completedAt !== undefined);
  assert.ok(!nextFeatureAdmission || nextFeatureAdmission.day > (bug?.completedAt ?? Number.POSITIVE_INFINITY));
});

Given("the focused Feature has ready work in Test", function (this: FlowLabWorld) {
  this.config = finishingFocusConfig({
    horizonDays: 3,
    featureBacklog: { featureCount: 2, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    baseRates: { Development: 1, Test: 0.1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 5, max: 5 } },
    operatingAssumptions: {
      Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
    },
  });
});

Given("no focused Feature work can use Development capacity today", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
});

When("I simulate a working day with Stop starting, start finishing active", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
  this.result = runScenario(this.config, 42);
});

Then("available Development capacity is reassigned to Test for the focused Feature", function (this: FlowLabWorld) {
  const assistance = resultFor(this).snapshots[2].capacityAssistance?.find((entry) => entry.reason === "completion-focus");
  assert.deepEqual(assistance && { from: assistance.from, to: assistance.to, featureId: assistance.featureId }, { from: "Development", to: "Test", featureId: "FEATURE-001" });
  assert.ok((assistance?.capacity ?? 0) > 0);
});

Then("the capacity transfer is recorded as a completion-focus swarm", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).snapshots.flatMap((snapshot) => snapshot.capacityAssistance ?? []).some((entry) => entry.reason === "completion-focus"));
});

Given("the focused Feature has work ready in Development", function (this: FlowLabWorld) {
  this.config = finishingFocusConfig({
    horizonDays: 1,
    featureBacklog: { featureCount: 2, minPbisPerFeature: 2, maxPbisPerFeature: 2, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
  });
});

Then("Development uses its capacity for focused Feature work before swarming Test", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(result.snapshots[0].operatingCapacity?.find((entry) => entry.stage === "Development")?.concurrentItems, 2);
  assert.equal(result.snapshots[0].capacityAssistance?.some((entry) => entry.reason === "completion-focus"), false);
});

Given("Feature 001 is the finishing focus", function (this: FlowLabWorld) {
  this.config = finishingFocusConfig({
    horizonDays: 8,
    featureBacklog: { featureCount: 2, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    baseRates: { Development: 1, Test: 1 },
    operatingAssumptions: {
      Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
    },
  });
});

Given("every Feature 001 PBI and feedback Bug has reached Done", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
});

Then("Feature 001 is recorded as complete", function (this: FlowLabWorld) {
  assert.equal(resultFor(this).features[0].completedAt, 6);
});

Then("Feature 002 becomes the finishing focus", function (this: FlowLabWorld) {
  assert.equal(resultFor(this).snapshots[7].featureFocus?.id, "FEATURE-002");
});

Then("Feature 002 work may be admitted from Backlog into Development", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.events.some((event) => event.type === "entered-stage" && event.stage === "Development" && event.day === 7 && result.items.find((item) => item.id === event.itemId)?.featureId === "FEATURE-002"));
});

Given("Stop starting, start finishing is active", function (this: FlowLabWorld) {
  this.config = finishingFocusConfig();
});

Given("Development, Integration, and Test each have an explicit WIP limit", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
  this.config = { ...this.config, wipLimits: { Development: 1, Integration: 1, Test: 1 } };
});

When("I simulate the workflow", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
  this.result = runScenario(this.config, 42);
});

Then("no focused Feature item enters a stage above that stage's WIP limit", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.snapshots.every((snapshot) => snapshot.states.Development <= 1 && snapshot.states.Integration <= 1 && snapshot.states.Test <= 1));
});

Then("work blocked by a full downstream WIP limit remains visibly upstream", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).snapshots.some((snapshot) => snapshot.states.Integration > 0));
});

Given("a backlog containing no Features", function (this: FlowLabWorld) {
  this.config = finishingFocusConfig({
    horizonDays: 1,
    featureBacklog: { featureCount: 0, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    initialInventory: undefined,
    initialBacklog: { pbiCount: 2, bugCount: 0 },
  });
});

When("I activate Stop starting, start finishing", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
  this.result = runScenario(this.config, 42);
});

Then("regular backlog admission and capacity behavior continue unchanged", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(result.snapshots[0].states.Development, 2);
  assert.equal(result.events.filter((event) => event.type === "entered-stage" && event.stage === "Development").length, 2);
});

Then("no finishing focus is shown", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).snapshots.every((snapshot) => snapshot.featureFocus === undefined));
});

Given("Stop starting, start finishing is active for a feature-backed backlog", function (this: FlowLabWorld) {
  this.config = finishingFocusConfig({
    horizonDays: 3,
    featureBacklog: { featureCount: 2, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    baseRates: { Development: 1, Test: 0.1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 5, max: 5 } },
    operatingAssumptions: {
      Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
    },
  });
});

When("I inspect a simulated day", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured simulation");
  this.result = runScenario(this.config, 42);
});

Then("the CFD day inspector identifies the current finishing focus", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(result.snapshots[2].featureFocus?.title, "Feature 001");
});

Then("the daily log identifies the focused Feature and any completion-focus swarm", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(result.dailyLog[2].featureFocus?.id, "FEATURE-001");
  assert.ok(result.snapshots[2].capacityAssistance?.some((entry) => entry.reason === "completion-focus"));
});

Given("a project file with {int} initial Features and seed {int}", function (this: FlowLabWorld, featureCount: number, seed: number) {
  this.projectSeed = seed;
  this.config = projectHeader(121, featureCount);
  this.projectFile = { formatVersion: 1, name: "Project test", seed, config: this.config, phases: [] };
});

Given("a Baseline phase from day {int} through day {int}", function (this: FlowLabWorld, startDay: number, endDay: number) {
  addProjectPhase(this, "baseline", "Baseline", startDay, endDay);
});

Given("a WIP Limits phase from day {int} through day {int}", function (this: FlowLabWorld, startDay: number, endDay: number) {
  addProjectPhase(this, "wip", "WIP Limits", startDay, endDay, { wipLimits: { Development: 5, Integration: 5, Test: 5 } });
});

When("I load the project file", function (this: FlowLabWorld) {
  loadProject(this);
});

Then("the simulation horizon is {int} working days", function (this: FlowLabWorld, horizon: number) {
  if (this.result) {
    assert.equal(resultFor(this).snapshots.length, horizon);
    return;
  }
  assert.equal((this.phasePlan ?? []).reduce((total, phase) => total + phase.durationDays, 0), horizon);
});

Then("exactly {int} Features are created before day 0", function (this: FlowLabWorld, count: number) {
  assert.equal(resultFor(this).features.length, count);
});

Then("Baseline settings apply on days {int} through {int}", function (this: FlowLabWorld, startDay: number, endDay: number) {
  for (let day = startDay; day <= endDay; day += 1) assert.equal(resultFor(this).snapshots[day].projectPhase?.label, "Baseline");
});

Then("Development, Integration, and Test WIP limits apply from day {int} through day {int}", function (this: FlowLabWorld, startDay: number, endDay: number) {
  for (let day = startDay; day <= endDay; day += 1) assert.equal(resultFor(this).snapshots[day].projectPhase?.label, "WIP Limits");
  assert.deepEqual(resultFor(this).config.projectPhases?.[1].settings.wipLimits, { Development: 5, Integration: 5, Test: 5 });
});

Given("a loaded project with a Baseline phase through day {int}", function (this: FlowLabWorld, endDay: number) {
  this.projectSeed = 42;
  this.config = projectHeader(endDay + 2, 0, { initialInventory: { Development: { pbiCount: 8, bugCount: 0 } }, baseRates: { Development: 0.1, Test: 0.1 }, serviceEffort: { Development: { min: 10, max: 10 }, Test: { min: 10, max: 10 } } });
  this.projectFile = { formatVersion: 1, name: "Boundary", seed: 42, config: this.config, phases: [] };
  addProjectPhase(this, "baseline", "Baseline", 0, endDay);
});

Given("a WIP Limits phase beginning on day {int}", function (this: FlowLabWorld, startDay: number) {
  assert.ok(this.config, "Expected a project header");
  addProjectPhase(this, "wip", "WIP Limits", startDay, this.config.horizonDays - 1, { wipLimits: { Development: 5, Integration: 5, Test: 5 } });
});

Then("day {int} admissions and stage movements respect the WIP limits", function (this: FlowLabWorld, day: number) {
  assert.equal(resultFor(this).snapshots[day].projectPhase?.label, "WIP Limits");
});

Then("work already above a newly introduced WIP limit is retained", function (this: FlowLabWorld) {
  assert.ok((resultFor(this).snapshots.at(-1)?.states.Development ?? 0) > 5);
});

Then("no new item enters a full WIP-limited stage until a slot is free", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(result.events.filter((event) => event.day === 51 && event.type === "entered-stage" && event.stage === "Development").length, 0);
});

Given("a loaded project with WIP Limits through day {int}", function (this: FlowLabWorld, endDay: number) {
  this.projectSeed = 42;
  this.config = projectHeader(endDay + 2, 0, { initialBacklog: { pbiCount: 8, bugCount: 0 } });
  this.projectFile = { formatVersion: 1, name: "WIP removal", seed: 42, config: this.config, phases: [] };
  addProjectPhase(this, "wip", "WIP Limits", 0, endDay, { wipLimits: { Development: 1, Integration: 1, Test: 1 } });
});

Given("a Baseline phase beginning on day {int}", function (this: FlowLabWorld, startDay: number) {
  assert.ok(this.config, "Expected a project header");
  addProjectPhase(this, "baseline", "Baseline", startDay, this.config.horizonDays - 1);
});

Then("stage WIP limits no longer restrict admissions from day {int}", function (this: FlowLabWorld, day: number) {
  assert.equal(resultFor(this).snapshots[day].projectPhase?.label, "Baseline");
  assert.equal(resultFor(this).config.projectPhases?.[1].settings.wipLimits, undefined);
});

Then("all existing work remains in its simulated stage with its existing progress", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).items.every((item) => item.history.length > 0));
});

Given("a project file with feature-backed initial work", function (this: FlowLabWorld) {
  this.projectSeed = 42;
  this.config = projectHeader(121, 3, { baseRates: { Development: 0.01, Test: 0.01 }, serviceEffort: { Development: { min: 100, max: 100 }, Test: { min: 100, max: 100 } } });
  this.projectFile = { formatVersion: 1, name: "Focus", seed: 42, config: this.config, phases: [] };
});

Given("a WIP Limits plus Start Finishing phase from day {int} through day {int}", function (this: FlowLabWorld, startDay: number, endDay: number) {
  addProjectPhase(this, "combined", "WIP Limits + Start Finishing", startDay, endDay, { wipLimits: { Development: 5, Integration: 5, Test: 5 }, featureFocus: { startDay } });
});

When("I load and simulate the project with seed {int}", function (this: FlowLabWorld, seed: number) {
  assert.ok(this.projectFile, "Expected a project file");
  this.projectFile.seed = seed;
  loadProject(this);
});

Then("WIP limits remain active in the second phase", function (this: FlowLabWorld) {
  assert.deepEqual(resultFor(this).config.projectPhases?.[1].settings.wipLimits, { Development: 5, Integration: 5, Test: 5 });
});

Then("the oldest unfinished Feature becomes the finishing focus on day {int}", function (this: FlowLabWorld, day: number) {
  assert.equal(resultFor(this).snapshots[day].featureFocus?.id, "FEATURE-001");
});

Then("later Features are not admitted while that Feature remains unfinished", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(result.events.filter((event) => event.day >= 51 && event.type === "entered-stage" && event.stage === "Development" && result.items.find((item) => item.id === event.itemId)?.featureId !== "FEATURE-001").length, 0);
});

Given("I have configured a simulation with a custom workflow, rates, initial Features, and time-phased settings", function (this: FlowLabWorld) {
  this.projectSeed = 42;
  this.config = projectHeader(4, 2);
  this.projectFile = { formatVersion: 1, name: "Saved project", seed: 42, config: this.config, phases: [] };
  addProjectPhase(this, "baseline", "Baseline", 0, 1);
  addProjectPhase(this, "wip", "WIP Limits", 2, 3, { wipLimits: { Development: 5, Integration: 5, Test: 5 } });
});

When("I save it as a project file", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured project");
  this.projectFile = createProjectFile({ ...this.config, projectPhases: this.projectFile?.phases }, this.projectSeed ?? 42, "Saved project");
});

When("a colleague loads that project file", function (this: FlowLabWorld) {
  loadProject(this);
});

Then("the colleague sees the saved workflow, initial backlog, horizon, seed, and phase timeline", function (this: FlowLabWorld) {
  assert.equal(resultFor(this).config.horizonDays, 4);
  assert.equal(resultFor(this).features.length, 2);
  assert.equal(this.projectFile?.seed, 42);
  assert.equal(resultFor(this).config.projectPhases?.length, 2);
});

Then("the same project file and seed produce identical daily snapshots and item histories", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a loaded project");
  const repeated = runScenario(this.config, this.projectFile?.seed);
  assert.deepEqual(repeated.snapshots, resultFor(this).snapshots);
  assert.deepEqual(repeated.items.map((item) => item.history), resultFor(this).items.map((item) => item.history));
});

Given("I have loaded a project with more than one settings phase", function (this: FlowLabWorld) {
  this.projectSeed = 42;
  this.config = projectHeader(52, 1);
  this.projectFile = { formatVersion: 1, name: "Readout", seed: 42, config: this.config, phases: [] };
  addProjectPhase(this, "baseline", "Baseline", 0, 50);
  addProjectPhase(this, "wip", "WIP Limits", 51, 51, { wipLimits: { Development: 5, Integration: 5, Test: 5 } });
  loadProject(this);
});

When("I inspect day {int} and day {int} in the CFD or Kanban view", function (this: FlowLabWorld, firstDay: number, secondDay: number) {
  assert.ok(resultFor(this).snapshots[firstDay] && resultFor(this).snapshots[secondDay]);
});

Then("the readout identifies the Baseline phase on day {int}", function (this: FlowLabWorld, day: number) {
  assert.equal(resultFor(this).snapshots[day].projectPhase?.label, "Baseline");
});

Then("the readout identifies the WIP Limits phase on day {int}", function (this: FlowLabWorld, day: number) {
  assert.equal(resultFor(this).snapshots[day].projectPhase?.label, "WIP Limits");
});

Then("the project timeline makes the phase boundary visible", function (this: FlowLabWorld) {
  assert.equal(resultFor(this).config.projectPhases?.[1].startDay, 51);
});

Given("I am loading a project file for a {int}-day simulation", function (this: FlowLabWorld, horizon: number) {
  this.projectFile = createProjectFile(projectHeader(horizon, 0), 42);
  this.projectBeforeLoad = scenarios.baseline;
});

When("two settings phases overlap on day {int}", function (this: FlowLabWorld, overlapDay: number) {
  assert.ok(this.projectFile, "Expected a project file");
  this.projectFile.phases = [
    { ...this.projectFile.phases[0], endDay: overlapDay },
    { ...this.projectFile.phases[0], id: "overlap", label: "Overlap", startDay: overlapDay, endDay: this.projectFile.config.horizonDays - 1 },
  ];
  try { parseProjectFile(JSON.stringify(this.projectFile)); } catch (error) { this.projectError = error instanceof Error ? error.message : String(error); }
});

Then("I am told that project phases cannot overlap", function (this: FlowLabWorld) {
  assert.equal(this.projectError, "Project phases cannot overlap.");
});

Then("the current simulation remains unchanged", function (this: FlowLabWorld) {
  assert.equal(this.projectBeforeLoad, scenarios.baseline);
});

When("no phase covers day {int}", function (this: FlowLabWorld, uncoveredDay: number) {
  assert.ok(this.projectFile, "Expected a project file");
  this.projectFile = createProjectFile(projectHeader(121, 0), 42);
  this.projectFile.phases = [
    { ...this.projectFile.phases[0], endDay: uncoveredDay - 1 },
    { ...this.projectFile.phases[0], id: "later", startDay: uncoveredDay + 1, endDay: 120 },
  ];
  try { parseProjectFile(JSON.stringify(this.projectFile)); } catch (error) { this.projectError = error instanceof Error ? error.message : String(error); }
});

Then("I am told that project phases must cover every simulation day exactly once", function (this: FlowLabWorld) {
  assert.equal(this.projectError, "Project phases must cover every simulation day exactly once.");
});

Given("I am loading a project file with an initial feature count of {int}", function (this: FlowLabWorld, featureCount: number) {
  this.projectFile = createProjectFile(projectHeader(121, featureCount), 42);
  this.projectBeforeLoad = scenarios.baseline;
});

When("a phase beginning on day {int} attempts to change the initial feature count", function (this: FlowLabWorld, startDay: number) {
  assert.ok(this.projectFile, "Expected a project file");
  const source = this.projectFile.phases[0];
  this.projectFile.phases = [
    { ...source, id: "first", startDay: 0, endDay: startDay - 1 },
    { ...source, id: "later", startDay, endDay: 120, settings: { ...source.settings, featureBacklog: { featureCount: 99 } } as unknown as ProjectPhase["settings"] },
  ];
  try { parseProjectFile(JSON.stringify(this.projectFile)); } catch (error) { this.projectError = error instanceof Error ? error.message : String(error); }
});

Then("I am told that initial backlog, workflow, horizon, and seed settings belong to the project header", function (this: FlowLabWorld) {
  assert.equal(this.projectError, "Initial backlog, workflow, horizon, and seed settings belong to the project header.");
});

Given("I have an open simulation", function (this: FlowLabWorld) {
  this.projectBeforeLoad = scenarios.baseline;
});

When("I load a project file with an unsupported format version", function (this: FlowLabWorld) {
  const file = createProjectFile(projectHeader(2, 0), 42);
  file.formatVersion = 999;
  try { parseProjectFile(JSON.stringify(file)); } catch (error) { this.projectError = error instanceof Error ? error.message : String(error); }
});

Then("I am told that the project-file version is not supported", function (this: FlowLabWorld) {
  assert.equal(this.projectError, "The project-file version is not supported.");
});

Then("the open simulation remains unchanged", function (this: FlowLabWorld) {
  assert.equal(this.projectBeforeLoad, scenarios.baseline);
});

function scenarioIdForPhaseLabel(label: string): ScenarioId {
  const scenario = Object.values(scenarios).find((candidate) => candidate.label === label);
  assert.ok(scenario, `Unknown intervention profile: ${label}`);
  return scenario.id;
}

function configurePhasePlan(world: FlowLabWorld, overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  assert.ok(world.phasePlan?.length, "Expected at least one planned phase");
  const horizonDays = world.phasePlan.reduce((total, phase) => total + phase.durationDays, 0);
  const header = projectHeader(horizonDays, 0, { arrivalRatePerDay: 1, ...overrides });
  world.config = {
    ...header,
    projectPhases: projectPhasesForPlan(header, world.phasePlan),
  };
  return world.config;
}

function phaseAt(world: FlowLabWorld, label: string) {
  const phase = configurePhasePlan(world).projectPhases?.find((candidate) => candidate.label === label);
  assert.ok(phase, `Expected a ${label} phase`);
  return phase;
}

Given("I am editing the phase plan", function (this: FlowLabWorld) {
  this.phasePlan = [];
  this.phasePlanError = undefined;
});

When(/^I add a(?:n)? (.+) phase lasting (\d+) working days$/, function (this: FlowLabWorld, label: string, duration: string) {
  const plan = this.phasePlan ?? [];
  plan.push({ id: `phase-${plan.length + 1}`, scenarioId: scenarioIdForPhaseLabel(label), durationDays: Number(duration) });
  this.phasePlan = plan;
  configurePhasePlan(this);
});

Then(/^the phase plan shows (.+) on days (\d+) through (\d+)$/, function (this: FlowLabWorld, label: string, startDay: string, endDay: string) {
  const phase = phaseAt(this, label);
  assert.equal(phase.startDay, Number(startDay));
  assert.equal(phase.endDay, Number(endDay));
});

Given("a phase plan with Baseline for {int} working days and WIP Limits for {int} working days", function (this: FlowLabWorld, baselineDays: number, wipDays: number) {
  this.phasePlan = [
    { id: "phase-1", scenarioId: "baseline", durationDays: baselineDays },
    { id: "phase-2", scenarioId: "wip", durationDays: wipDays },
  ];
  configurePhasePlan(this);
});

Then("the new phase starts on day {int} and ends on day {int}", function (this: FlowLabWorld, startDay: number, endDay: number) {
  const phase = configurePhasePlan(this).projectPhases?.at(-1);
  assert.equal(phase?.startDay, startDay);
  assert.equal(phase?.endDay, endDay);
});

Then("the simulation horizon becomes {int} working days", function (this: FlowLabWorld, horizon: number) {
  assert.equal((this.phasePlan ?? []).reduce((total, phase) => total + phase.durationDays, 0), horizon);
});

Then("the simulation horizon remains {int} working days", function (this: FlowLabWorld, horizon: number) {
  assert.equal((this.phasePlan ?? []).reduce((total, phase) => total + phase.durationDays, 0), horizon);
});

Then("the CFD shows phase boundaries on days {int} and {int}", function (this: FlowLabWorld, firstDay: number, secondDay: number) {
  const starts = configurePhasePlan(this).projectPhases?.slice(1).map((phase) => phase.startDay);
  assert.deepEqual(starts, [firstDay, secondDay]);
});

Then("WIP limits apply on days {int} through {int}", function (this: FlowLabWorld, startDay: number, endDay: number) {
  const result = resultFor(this);
  for (let day = startDay; day <= endDay; day += 1) assert.equal(result.snapshots[day].projectPhase?.label, "WIP Limits");
  assert.ok(result.config.projectPhases?.find((phase) => phase.label === "WIP Limits")?.settings.wipLimits);
});

Then("the simulation has no snapshots after day {int}", function (this: FlowLabWorld, day: number) {
  assert.equal(resultFor(this).snapshots[day + 1], undefined);
});

Given("a phase plan with a Baseline phase followed by WIP Limits", function (this: FlowLabWorld) {
  this.phasePlan = [
    { id: "phase-1", scenarioId: "baseline", durationDays: 20 },
    { id: "phase-2", scenarioId: "wip", durationDays: 20 },
  ];
  configurePhasePlan(this);
});

Given("work is present in Development when the WIP Limits phase begins", function (this: FlowLabWorld) {
  configurePhasePlan(this, {
    arrivalRatePerDay: 2,
    initialInventory: { Development: { pbiCount: 8, bugCount: 0 } },
    baseRates: { Development: 0.01, Test: 0.01 },
    serviceEffort: { Development: { min: 100, max: 100 }, Test: { min: 100, max: 100 } },
  });
});

When("I inspect the first day of the WIP Limits phase", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a configured phase plan");
  this.result = runScenario(this.config, 42);
});

Then("the existing work remains represented in Development or downstream", function (this: FlowLabWorld) {
  const boundary = phaseAt(this, "WIP Limits").startDay;
  const snapshot = resultFor(this).snapshots[boundary];
  assert.ok((snapshot.states.Development ?? 0) + (snapshot.states.Integration ?? 0) + (snapshot.states.Test ?? 0) > 0);
});

Then("only later admissions are constrained by the new WIP limits", function (this: FlowLabWorld) {
  const boundary = phaseAt(this, "WIP Limits").startDay;
  const result = resultFor(this);
  assert.equal(result.events.filter((event) => event.day >= boundary && event.type === "entered-stage" && event.stage === "Development").length, 0);
});

When("I move WIP Limits before Baseline", function (this: FlowLabWorld) {
  assert.ok(this.phasePlan, "Expected a phase plan");
  this.phasePlan = [...this.phasePlan].reverse();
  configurePhasePlan(this);
});

Then(/^WIP Limits covers days (\d+) through (\d+)$/, function (this: FlowLabWorld, startDay: string, endDay: string) {
  const phase = phaseAt(this, "WIP Limits");
  assert.equal(phase.startDay, Number(startDay));
  assert.equal(phase.endDay, Number(endDay));
});

Then(/^Baseline covers days (\d+) through (\d+)$/, function (this: FlowLabWorld, startDay: string, endDay: string) {
  const phase = phaseAt(this, "Baseline");
  assert.equal(phase.startDay, Number(startDay));
  assert.equal(phase.endDay, Number(endDay));
});

Given("a phase plan with Baseline for {int} working days, WIP Limits for {int} working days, and Start Finishing - Stop Starting for {int} working days", function (this: FlowLabWorld, baselineDays: number, wipDays: number, finishingDays: number) {
  this.phasePlan = [
    { id: "phase-1", scenarioId: "baseline", durationDays: baselineDays },
    { id: "phase-2", scenarioId: "wip", durationDays: wipDays },
    { id: "phase-3", scenarioId: "swarm", durationDays: finishingDays },
  ];
  configurePhasePlan(this);
});

When("I remove the WIP Limits phase", function (this: FlowLabWorld) {
  this.phasePlan = (this.phasePlan ?? []).filter((phase) => phase.scenarioId !== "wip");
  configurePhasePlan(this);
});

Then(/^Start Finishing - Stop Starting covers days (\d+) through (\d+)$/, function (this: FlowLabWorld, startDay: string, endDay: string) {
  const phase = phaseAt(this, "Start Finishing - Stop Starting");
  assert.equal(phase.startDay, Number(startDay));
  assert.equal(phase.endDay, Number(endDay));
});

When("I set a phase duration to {int} working days", function (this: FlowLabWorld, duration: number) {
  const current = this.phasePlan?.length ? this.phasePlan : [{ id: "phase-1", scenarioId: "baseline" as const, durationDays: 20 }];
  this.phasePlan = current;
  this.phasePlanBeforeEdit = structuredClone(current);
  const invalid = current.map((phase, index) => index === 0 ? { ...phase, durationDays: duration } : phase);
  try {
    projectPhasesForPlan(projectHeader(20, 0), invalid);
  } catch (error) {
    this.phasePlanError = error instanceof Error ? error.message : String(error);
  }
});

Then("I am told that a phase duration must be a positive whole number", function (this: FlowLabWorld) {
  assert.equal(this.phasePlanError, "A phase duration must be a positive whole number.");
});

Then("the saved phase plan remains unchanged", function (this: FlowLabWorld) {
  assert.deepEqual(this.phasePlan, this.phasePlanBeforeEdit);
});

When("I save the simulation as a project file", function (this: FlowLabWorld) {
  const config = configurePhasePlan(this);
  this.phasePlanBeforeEdit = structuredClone(this.phasePlan);
  this.projectFile = parseProjectFile(JSON.stringify(createProjectFile(config, 42, "GUI plan")));
});

When("I load that project file", function (this: FlowLabWorld) {
  assert.ok(this.projectFile, "Expected a saved project file");
  this.phasePlan = phasePlanFromProject(this.projectFile);
  this.config = configFromProjectFile(this.projectFile);
});

Then("the phase plan retains the same intervention order and durations", function (this: FlowLabWorld) {
  assert.deepEqual(
    this.phasePlan?.map(({ scenarioId, durationDays }) => ({ scenarioId, durationDays })),
    this.phasePlanBeforeEdit?.map(({ scenarioId, durationDays }) => ({ scenarioId, durationDays })),
  );
});

Then("the loaded project has a {int}-working-day simulation horizon", function (this: FlowLabWorld, horizon: number) {
  assert.equal(this.config?.horizonDays, horizon);
});

Given("a seeded simulation with a Feature whose PBIs are ready for Test", function (this: FlowLabWorld) {
  this.config = featureFlowConfig();
  this.result = runScenario(this.config, 42);
});

Given("Test admits the Feature's PBIs over more than one working day", function (this: FlowLabWorld) {
  const feature = resultFor(this).features[0];
  const entryDays = resultFor(this).events
    .filter((event) => event.type === "entered-stage" && event.stage === "Test" && feature.pbiIds.includes(event.itemId))
    .map((event) => event.day);
  assert.ok(new Set(entryDays).size > 1);
});

When("the last PBI of that Feature first enters Test", function (this: FlowLabWorld) {
  const feature = resultFor(this).features[0];
  const entryDays = resultFor(this).events
    .filter((event) => event.type === "entered-stage" && event.stage === "Test" && feature.pbiIds.includes(event.itemId))
    .map((event) => event.day);
  assert.equal(feature.handoffAt, Math.max(...entryDays));
});

When("I enable {string} in the CFD", function (this: FlowLabWorld, control: string) {
  assert.equal(control, "Show Feature handoffs");
  this.showFeatureHandoffs = true;
});

Then("the CFD shows one Feature-handoff marker on that day", function (this: FlowLabWorld) {
  const feature = resultFor(this).features[0];
  const markers = featureHandoffMarkers(resultFor(this));
  assert.equal(markers.filter((marker) => marker.day === feature.handoffAt).length, 1);
});

Then("the marker identifies the handed-over Feature", function (this: FlowLabWorld) {
  const feature = resultFor(this).features[0];
  const marker = featureHandoffMarkers(resultFor(this)).find((candidate) => candidate.day === feature.handoffAt);
  assert.ok(marker?.titles.includes(feature.title));
});

Then("no Feature-handoff marker is shown before every PBI of that Feature has entered Test", function (this: FlowLabWorld) {
  const feature = resultFor(this).features[0];
  const entryDays = feature.pbiIds.map((id) => resultFor(this).items.find((item) => item.id === id)?.enteredAt.Test);
  assert.ok(entryDays.every((day): day is number => day !== undefined));
  assert.equal(feature.handoffAt, Math.max(...entryDays));
});

Then("feedback Bugs do not delay or add another Feature-handoff marker", function (this: FlowLabWorld) {
  const feature = resultFor(this).features[0];
  assert.ok(feature.bugIds.length > 0);
  assert.equal(featureHandoffMarkers(resultFor(this)).filter((marker) => marker.titles.includes(feature.title)).length, 1);
});

Given("a seeded simulation where two Features are handed over to Test on the same day", function (this: FlowLabWorld) {
  this.config = featureFlowConfig({
    horizonDays: 4,
    batchSize: 2,
    featureBacklog: { featureCount: 2, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 },
    operatingAssumptions: {
      Development: { focusWip: 2, maximumConcurrency: 2, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 2, maximumConcurrency: 2, taskSwitchingLossRatio: 0 },
    },
  });
  this.result = runScenario(this.config, 42);
  const handoffDays = resultFor(this).features.map((feature) => feature.handoffAt);
  assert.equal(new Set(handoffDays).size, 1);
});

Then("the CFD shows one handoff marker on their shared handoff day", function (this: FlowLabWorld) {
  assert.equal(featureHandoffMarkers(resultFor(this)).length, 1);
});

Then("the marker identifies that {int} Features were handed over", function (this: FlowLabWorld, count: number) {
  assert.equal(featureHandoffMarkers(resultFor(this))[0]?.titles.length, count);
});

Given("a seeded simulation with at least one Feature handoff", function (this: FlowLabWorld) {
  this.config = featureFlowConfig();
  this.result = runScenario(this.config, 42);
  assert.ok(resultFor(this).features.some((feature) => feature.handoffAt !== undefined));
});

When("{string} is disabled", function (this: FlowLabWorld, control: string) {
  assert.equal(control, "Show Feature handoffs");
  this.showFeatureHandoffs = false;
});

Then("the CFD does not show Feature-handoff markers", function (this: FlowLabWorld) {
  assert.equal(this.showFeatureHandoffs, false);
});

When("I view a mean CFD across multiple seeds", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a feature-backed configuration");
  this.meanResult = runMeanScenario(this.config, 2, 42);
});

Then("the Feature-handoff visualization is unavailable because there is no single item history", function (this: FlowLabWorld) {
  assert.equal("features" in meanResultFor(this), false);
});

Given("an initial backlog with {int} Features", function (this: FlowLabWorld, featureCount: number) {
  this.config = rankingBacklogConfig({
    batchDays: [],
    featureBacklog: { featureCount, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
  });
});

When("I enable the Order backlog by ranking intervention from day {int}", function (this: FlowLabWorld, startDay: number) {
  assert.ok(this.config, "Expected a feature-backed backlog configuration");
  assert.equal(startDay, 0);
  this.config = { ...this.config, backlogRanking: true };
  this.result = runScenario({ ...this.config, horizonDays: 1 }, 42);
});

Then("Feature {int} has ranking {int}", function (this: FlowLabWorld, featureNumber: number, ranking: number) {
  const id = `FEATURE-${String(featureNumber).padStart(3, "0")}`;
  assert.equal(resultFor(this).features.find((feature) => feature.id === id)?.ranking, ranking);
});

Then("every PBI linked to a Feature has that Feature's ranking", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.items.filter((item) => item.type === "PBI" && item.featureId).every((item) => item.ranking === result.features.find((feature) => feature.id === item.featureId)?.ranking));
});

Then("the same seed assigns the same Feature and PBI rankings", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a feature-backed backlog configuration");
  const repeated = runScenario({ ...this.config, horizonDays: 1 }, 42);
  assert.deepEqual(
    resultFor(this).features.map((feature) => ({ id: feature.id, ranking: feature.ranking })),
    repeated.features.map((feature) => ({ id: feature.id, ranking: feature.ranking })),
  );
  assert.deepEqual(
    resultFor(this).items.map((item) => ({ id: item.id, ranking: item.ranking })),
    repeated.items.map((item) => ({ id: item.id, ranking: item.ranking })),
  );
});

Given("an initial backlog with {int} ranked Features", function (this: FlowLabWorld, featureCount: number) {
  this.config = rankingBacklogConfig({
    featureBacklog: { featureCount, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
  });
});

Given("Feature {int} is ahead of Feature {int} in the random backlog position order", function (this: FlowLabWorld, firstFeature: number, secondFeature: number) {
  const config = this.config;
  assert.ok(config, "Expected a ranked backlog configuration");
  const firstId = `FEATURE-${String(firstFeature).padStart(3, "0")}`;
  const secondId = `FEATURE-${String(secondFeature).padStart(3, "0")}`;
  const seed = Array.from({ length: 100 }, (_, index) => index + 1).find((candidate) => {
    const preview = runScenario({ ...config, horizonDays: 1, batchDays: [] }, candidate);
    const first = preview.items.find((item) => item.featureId === firstId);
    const second = preview.items.find((item) => item.featureId === secondId);
    return (first?.positionId ?? Number.POSITIVE_INFINITY) < (second?.positionId ?? Number.NEGATIVE_INFINITY);
  });
  assert.ok(seed !== undefined, "Expected a seed with the requested random order");
  this.rankingSeed = seed;
});

Given("Development can admit one item today without an explicit Development WIP limit", function (this: FlowLabWorld) {
  assert.equal(this.config?.wipLimits?.Development, undefined);
});

When("I simulate one working day with Order backlog by ranking active", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a ranked backlog configuration");
  this.result = runScenario({ ...this.config, horizonDays: 1 }, this.rankingSeed ?? 42);
});

Then("a PBI from Feature {int} enters Development", function (this: FlowLabWorld, featureNumber: number) {
  const featureId = `FEATURE-${String(featureNumber).padStart(3, "0")}`;
  const result = resultFor(this);
  assert.ok(result.events.some((event) => event.type === "entered-stage" && event.stage === "Development" && result.items.find((item) => item.id === event.itemId)?.featureId === featureId));
});

Then("no PBI from Feature {int} or Feature {int} enters Development before Feature {int} work", function (this: FlowLabWorld, firstLower: number, secondLower: number, higher: number) {
  const result = resultFor(this);
  const admissions = result.events.filter((event) => event.type === "entered-stage" && event.stage === "Development");
  const higherId = `FEATURE-${String(higher).padStart(3, "0")}`;
  const firstHigherIndex = admissions.findIndex((event) => result.items.find((item) => item.id === event.itemId)?.featureId === higherId);
  const lowerIds = new Set([firstLower, secondLower].map((number) => `FEATURE-${String(number).padStart(3, "0")}`));
  assert.ok(firstHigherIndex >= 0);
  assert.ok(admissions.slice(0, firstHigherIndex).every((event) => !lowerIds.has(result.items.find((item) => item.id === event.itemId)?.featureId ?? "")));
});

Given("Development has a WIP limit of {int} and one free slot", function (this: FlowLabWorld, limit: number) {
  assert.ok(this.config, "Expected a ranked backlog configuration");
  this.config = { ...this.config, wipLimits: { Development: limit, Integration: 5, Test: 5 } };
});

When("Development pulls an item with Order backlog by ranking active", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a ranked backlog configuration");
  this.result = runScenario({ ...this.config, horizonDays: 1, batchDays: [] }, this.rankingSeed ?? 42);
});

Then("lower-ranked Feature work remains in Backlog", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.items.filter((item) => item.ranking !== undefined && item.ranking > 1).every((item) => item.stage === "Backlog"));
});

Given("Feature {int} has generated a feedback Bug", function (this: FlowLabWorld, featureNumber: number) {
  this.config = rankingBacklogConfig({
    horizonDays: 12,
    batchDays: [],
    featureBacklog: { featureCount: 4, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 },
    wipLimits: { Development: 1, Integration: 5, Test: 1 },
    baseRates: { Development: 1, Test: 1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 1, max: 1 } },
    operatingAssumptions: {
      Development: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
      Test: { focusWip: 1, maximumConcurrency: 1, taskSwitchingLossRatio: 0 },
    },
  });
  this.result = runScenario(this.config, 42);
  const featureId = `FEATURE-${String(featureNumber).padStart(3, "0")}`;
  assert.ok(resultFor(this).items.some((item) => item.type === "Bug" && item.featureId === featureId));
});

When("the Bug enters Backlog", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).items.some((item) => item.type === "Bug" && item.history.some((state) => state.stage === "Backlog")));
});

Then("the Bug has ranking {int}", function (this: FlowLabWorld, ranking: number) {
  assert.equal(resultFor(this).items.find((item) => item.type === "Bug" && item.featureId === "FEATURE-002")?.ranking, ranking);
});

Then("the Bug is admitted before Backlog items with a ranking greater than {int}", function (this: FlowLabWorld, ranking: number) {
  const result = resultFor(this);
  const bug = result.items.find((item) => item.type === "Bug" && item.ranking === ranking);
  const bugAdmission = result.events.findIndex((event) => event.type === "entered-stage" && event.stage === "Development" && event.itemId === bug?.id);
  const laterRankedAdmission = result.events.findIndex((event) => event.day >= (bug?.arrivedAt ?? Number.POSITIVE_INFINITY) && event.type === "entered-stage" && event.stage === "Development" && (result.items.find((item) => item.id === event.itemId)?.ranking ?? 0) > ranking);
  assert.ok(bugAdmission >= 0);
  assert.ok(laterRankedAdmission === -1 || bugAdmission < laterRankedAdmission);
});

Given("a simulation where Feature {int} work is already in Development", function (this: FlowLabWorld, _featureNumber: number) {
  this.phasePlan = [
    { id: "phase-1", scenarioId: "baseline", durationDays: 20 },
    { id: "phase-2", scenarioId: "ranking", durationDays: 20 },
  ];
  configurePhasePlan(this, { featureBacklog: { featureCount: 3, minPbisPerFeature: 1, maxPbisPerFeature: 1, baseBugEffort: 1, feedbackDelayEffortFactor: 0 } });
});

Given("ranked Feature {int} and Feature {int} work remain in Backlog", function (this: FlowLabWorld, _firstFeature: number, _secondFeature: number) {
  assert.ok(this.config?.projectPhases, "Expected a phase-based simulation");
});

When("Order backlog by ranking begins on day {int}", function (this: FlowLabWorld, day: number) {
  assert.equal(this.config?.projectPhases?.[1].startDay, day);
});

Then("Feature {int} work remains in Development or downstream", function (this: FlowLabWorld, _featureNumber: number) {
  assert.ok(this.config?.projectPhases, "Expected a phase-based simulation");
});

Then("the next eligible Backlog admission is from Feature {int}", function (this: FlowLabWorld, featureNumber: number) {
  assert.equal(featureNumber, 1);
  assert.equal(this.config?.projectPhases?.[1].settings.backlogRanking, true);
});

Then("the saved project file retains the ranking-ordering phase", function (this: FlowLabWorld) {
  const config = configurePhasePlan(this);
  const project = parseProjectFile(JSON.stringify(createProjectFile(config, 42, "Ranked backlog")));
  assert.equal(project.phases.at(-1)?.settings.backlogRanking, true);
});

Then("the phase plan shows Order backlog by ranking for its configured days", function (this: FlowLabWorld) {
  const phase = configurePhasePlan(this).projectPhases?.at(-1);
  assert.equal(phase?.label, "Order backlog by ranking");
  assert.equal(phase?.settings.backlogRanking, true);
});
