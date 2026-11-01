import assert from "node:assert/strict";
import { Given, Then, When, World, setWorldConstructor } from "@cucumber/cucumber";
import { effectiveCapacityFor, processingRateFor, runScenario } from "../../src/sim/engine";
import { runMeanScenario, validateMeanSeedCount } from "../../src/sim/mean";
import { scenarios } from "../../src/sim/scenarios";
import { validateOperatingAssumptions, withOperatingAssumptions, withProcessingRates, withSimulationSettings } from "../../src/sim/settings";
import type { CapacityIncident, InitialBacklog, InitialInventory, ItemTimelineState, MeanSimulationResult, OperatingAssumptions, ScenarioConfig, SimulationResult, SwarmPolicy, WorkItem } from "../../src/sim/types";
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
  inspectedItemId?: string;
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

function wipPullConfig(): ScenarioConfig {
  return {
    ...scenarios.wip,
    horizonDays: 3,
    warmupDays: 0,
    arrivalRatePerDay: 0,
    batchDays: [0],
    batchSize: 3,
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
    baseRates: { Development: 3, Test: 0.1 },
    serviceEffort: { Development: { min: 1, max: 1 }, Test: { min: 5, max: 5 } },
    wipLimits: { Development: 3, Test: 1 },
  };
}

function assistanceConfig(effectiveness = 0.75): ScenarioConfig {
  return {
    ...scenarios.wip,
    horizonDays: 2,
    warmupDays: 0,
    arrivalRatePerDay: 0,
    batchDays: [0],
    batchSize: 1,
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

Given("the standard FlowLab baseline scenario", function (this: FlowLabWorld) {
  this.config = scenarios.baseline;
});

Given("the baseline scenario with a scheduled Test swarm", function (this: FlowLabWorld) {
  this.config = scenarios.swarm;
});

Given("the baseline scenario with Development and Test WIP limits", function (this: FlowLabWorld) {
  this.config = scenarios.wip;
});

When("I simulate 120 working days with seed {int}", function (this: FlowLabWorld, seed: number) {
  assert.ok(this.config, "Choose a scenario before simulating");
  this.result = runScenario(this.config, seed);
  this.baseline = runScenario(scenarios.baseline, seed);
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
  let arrivals = 0;
  for (const snapshot of result.snapshots) {
    arrivals += snapshot.arrivals;
    const accountedFor = Object.values(snapshot.states).reduce((total, count) => total + count, 0) + snapshot.externalBacklog;
    assert.equal(accountedFor, arrivals, `Conservation failed on day ${snapshot.day}`);
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

Then("movements into the workflow are recorded as External to Backlog", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(
    movementCount(result, "External", "Backlog"),
    result.items.length,
  );
});

Then("movements through the workflow are recorded as Backlog to Development and Development to Test", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(movementCount(result, "Backlog", "Development") > 0);
  assert.ok(movementCount(result, "Development", "Test") > 0);
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

Then("the sum of all daily External to Backlog movements equals the number of arrived items", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const arrivals = result.snapshots.reduce((total, snapshot) => total + snapshot.arrivals, 0);
  const loggedArrivals = movementCount(result, "External", "Backlog");
  assert.equal(loggedArrivals, arrivals);
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
  this.config = withWorkflow(scenarios.baseline, states);
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

Given("I am editing the arrival rate", function (this: FlowLabWorld) {
  this.config = scenarios.baseline;
  this.arrivalRateBeforeEdit = this.config.arrivalRatePerDay;
});

When("I save an average arrival rate of {float} items per day", function (this: FlowLabWorld, arrivalRatePerDay: number) {
  assert.ok(this.config, "Choose a scenario before editing the arrival rate");
  try {
    this.config = withSimulationSettings(this.config, { arrivalRatePerDay });
  } catch (error) {
    this.arrivalRateError = error instanceof Error ? error.message : String(error);
  }
});

Then("the simulation uses an average arrival rate of {float} items per day", function (this: FlowLabWorld, arrivalRatePerDay: number) {
  assert.equal(resultFor(this).config.arrivalRatePerDay, arrivalRatePerDay);
});

Then("the same seed and arrival rate produce identical daily snapshots", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.deepEqual(result.snapshots, runScenario(result.config, result.seed).snapshots);
});

Then("I am told that the arrival rate must be zero or greater", function (this: FlowLabWorld) {
  assert.equal(this.arrivalRateError, "The arrival rate must be zero or greater.");
});

Then("the current arrival rate remains unchanged", function (this: FlowLabWorld) {
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

Then("the item remains in Development until Test has a free slot", function (this: FlowLabWorld) {
  assert.ok((resultFor(this).snapshots[1].states.Development ?? 0) > 0);
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
  return {
    ...scenarios.baseline,
    horizonDays: 2,
    warmupDays: 0,
    arrivalRatePerDay: 0,
    batchDays: [0],
    batchSize: wipLimit === undefined ? maximumConcurrency + 1 : wipLimit + 1,
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
  const result = runScenario({ ...this.config, horizonDays: 1, batchDays: [0], batchSize: 4, arrivalRatePerDay: 0 }, 1);
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

Then("the configured daily arrivals continue independently of the initial backlog", function (this: FlowLabWorld) {
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

Given("the arriving PBI share is {float}", function (this: FlowLabWorld, ratio: number) {
  assert.ok(this.config, "Expected a simulation configuration");
  this.config = withSimulationSettings(this.config, { arrivalPbiRatio: ratio });
});

When("new work arrives during the simulation", function (this: FlowLabWorld) {
  assert.ok(this.config, "Expected a simulation configuration");
  this.config = { ...this.config, horizonDays: 2, arrivalRatePerDay: 0, batchDays: [1], batchSize: 4 };
  this.result = runScenario(this.config, 42);
  this.secondResult = runScenario(this.config, 42);
});

Then("each arriving item has a unique ID and non-empty title", function (this: FlowLabWorld) {
  const arriving = resultFor(this).items.filter((item) => !item.initial);
  assert.ok(arriving.length > 0);
  assert.equal(new Set(arriving.map((item) => item.id)).size, arriving.length);
  assert.ok(arriving.every((item) => item.title.trim().length > 0));
});

Then("each arriving item identifies whether it is a PBI or a bug", function (this: FlowLabWorld) {
  assert.ok(resultFor(this).items.filter((item) => !item.initial).every((item) => item.type === "PBI" || item.type === "Bug"));
});

Then("each arriving item starts in the entry workflow stage with inactive status, 0 percent progress, and empty start and completion dates", function (this: FlowLabWorld) {
  const entryStage = resultFor(this).config.workflow.stages[0];
  for (const item of resultFor(this).items.filter((candidate) => !candidate.initial)) {
    const initialState = item.history[0];
    assert.equal(initialState.stage, entryStage);
    assert.equal(initialState.active, false);
    assert.equal(initialState.progressPercent, 0);
    assert.equal(initialState.startDate, undefined);
    assert.equal(initialState.completionDate, undefined);
  }
});

Then("no arriving item reuses an ID from the initial backlog or a prior arrival", function (this: FlowLabWorld) {
  const ids = resultFor(this).items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

Then("the same seed produces the same arriving item IDs, titles, types, and arrival days", function (this: FlowLabWorld) {
  const identify = (result: SimulationResult | undefined) => result?.items.filter((item) => !item.initial).map(({ id, title, type, arrivedAt }) => ({ id, title, type, arrivedAt }));
  assert.deepEqual(identify(resultFor(this)), identify(this.secondResult));
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
    horizonDays: 3,
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
    horizonDays: 3,
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
