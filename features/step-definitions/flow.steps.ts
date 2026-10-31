import assert from "node:assert/strict";
import { Given, Then, When, World, setWorldConstructor } from "@cucumber/cucumber";
import { processingRateFor, runScenario } from "../../src/sim/engine";
import { runMeanScenario, validateMeanSeedCount } from "../../src/sim/mean";
import { scenarios } from "../../src/sim/scenarios";
import { withProcessingRates, withSimulationSettings } from "../../src/sim/settings";
import type { CapacityIncident, MeanSimulationResult, ScenarioConfig, SimulationResult, SwarmPolicy } from "../../src/sim/types";
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

Given("the standard FlowLab baseline scenario", function (this: FlowLabWorld) {
  this.config = scenarios.baseline;
});

Given("the baseline scenario with a scheduled Review swarm", function (this: FlowLabWorld) {
  this.config = scenarios.swarm;
});

Given("the baseline scenario with Development and Review WIP limits", function (this: FlowLabWorld) {
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

Then("the Code Review CFD band widens during the incident", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const { startDay, endDay } = result.config.incident;
  const atStart = result.snapshots[startDay].states.Review;
  const atEnd = result.snapshots[endDay].states.Review;
  assert.ok(atEnd > atStart, `Expected Review WIP to grow during incident (${atStart} → ${atEnd})`);
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

Then("the swarm runs after the review incident", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.config.swarm, "Expected selected scenario to include a swarm");
  assert.ok(result.config.swarm.startDay > result.config.incident.endDay);
});

Then("Review queue-days are lower than in the baseline for the same seed", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(this.baseline, "Expected baseline comparison");
  assert.ok(
    result.metrics.reviewQueueDays < this.baseline.metrics.reviewQueueDays,
    `Expected swarm Review queue-days (${result.metrics.reviewQueueDays}) below baseline (${this.baseline.metrics.reviewQueueDays})`,
  );
});

Then("Review WIP never exceeds {int} items", function (this: FlowLabWorld, limit: number) {
  const result = resultFor(this);
  assert.ok(result.snapshots.every((snapshot) => snapshot.states.Review <= limit));
});

Then("constrained work remains visible upstream", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.snapshots.some((snapshot) => snapshot.states.Ready > 0 || snapshot.states.Development >= 6));
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

Then("movements into the workflow are recorded as External to Ready", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(
    movementCount(result, "External", "Ready"),
    result.items.length,
  );
});

Then("movements through the workflow are recorded as Ready to Development, Development to Review, and Review to Test", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(movementCount(result, "Ready", "Development") > 0);
  assert.ok(movementCount(result, "Development", "Review") > 0);
  assert.ok(movementCount(result, "Review", "Test") > 0);
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

Then("the sum of all daily External to Ready movements equals the number of arrived items", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const arrivals = result.snapshots.reduce((total, snapshot) => total + snapshot.arrivals, 0);
  const loggedArrivals = movementCount(result, "External", "Ready");
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

When("I save a daily processing rate of 0 for Review", function (this: FlowLabWorld) {
  assert.ok(this.config, "Choose a scenario before editing capacity");
  try {
    this.config = withProcessingRates(this.config, { Review: 0 });
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

When("I set an incident in Review from day {int} through day {int} with a daily processing rate of {float}", function (this: FlowLabWorld, startDay: number, endDay: number, ratePerDay: number) {
  assert.ok(this.config, "Choose a scenario before editing interventions");
  const incident: CapacityIncident = { stage: "Review", startDay, endDay, ratePerDay };
  this.config = withSimulationSettings(this.config, { incident });
});

Then("the simulation applies the configured incident only to Review on days {int} through {int}", function (this: FlowLabWorld, startDay: number, endDay: number) {
  const result = resultFor(this);
  assert.equal(result.config.incident.stage, "Review");
  assert.equal(result.config.incident.startDay, startDay);
  assert.equal(result.config.incident.endDay, endDay);
  assert.equal(processingRateFor("Development", startDay, result.config), result.config.baseRates.Development);
  assert.equal(processingRateFor("Review", startDay - 1, result.config), result.config.baseRates.Review);
  assert.equal(processingRateFor("Review", endDay + 1, result.config), result.config.baseRates.Review);
});

Then("Review uses a daily processing rate of {float} while the incident is active", function (this: FlowLabWorld, rate: number) {
  const result = resultFor(this);
  assert.equal(processingRateFor("Review", result.config.incident.startDay, result.config), rate);
  assert.equal(processingRateFor("Review", result.config.incident.endDay, result.config), rate);
});

When("I set a swarm from Development to Review starting on day {int} for {int} days", function (this: FlowLabWorld, startDay: number, durationDays: number) {
  this.pendingSwarm = { sourceStage: "Development", targetStage: "Review", startDay, durationDays, capacityShift: 0.5, rampUpEffectiveness: 0.75 };
});

When("I set the swarm capacity shift to {float} and the first-day effectiveness to {float}", function (this: FlowLabWorld, capacityShift: number, rampUpEffectiveness: number) {
  assert.ok(this.config, "Choose a scenario before editing interventions");
  assert.ok(this.pendingSwarm, "Choose a swarm before editing it");
  this.config = withSimulationSettings(this.config, {
    swarm: { ...this.pendingSwarm, capacityShift, rampUpEffectiveness },
  });
});

Then("the simulation temporarily shifts {float} daily capacity from Development to Review", function (this: FlowLabWorld, shift: number) {
  const result = resultFor(this);
  assert.ok(result.config.swarm, "Expected a configured swarm");
  const steadyDay = result.config.swarm.startDay + 1;
  assert.equal(processingRateFor("Development", steadyDay, result.config), result.config.baseRates.Development! - shift);
  assert.equal(processingRateFor("Review", steadyDay, result.config), result.config.baseRates.Review! + shift);
});

Then("Review receives {float} daily capacity from the swarm on its first day", function (this: FlowLabWorld, contribution: number) {
  const result = resultFor(this);
  assert.ok(result.config.swarm, "Expected a configured swarm");
  const firstDayRate = processingRateFor("Review", result.config.swarm.startDay, result.config);
  assert.ok(Math.abs(firstDayRate - result.config.baseRates.Review! - contribution) < 1e-9);
});

Then("the swarm stops after {int} days", function (this: FlowLabWorld, duration: number) {
  const result = resultFor(this);
  assert.ok(result.config.swarm, "Expected a configured swarm");
  const afterSwarm = result.config.swarm.startDay + duration;
  assert.equal(processingRateFor("Development", afterSwarm, result.config), result.config.baseRates.Development);
  assert.equal(processingRateFor("Review", afterSwarm, result.config), result.config.baseRates.Review);
});

When("I save a swarm that starts and ends in the same stage", function (this: FlowLabWorld) {
  assert.ok(this.config, "Choose a scenario before editing interventions");
  try {
    this.config = withSimulationSettings(this.config, {
      swarm: { sourceStage: "Review", targetStage: "Review", startDay: 45, durationDays: 10, capacityShift: 0.5, rampUpEffectiveness: 0.75 },
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
