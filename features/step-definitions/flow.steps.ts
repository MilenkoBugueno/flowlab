import assert from "node:assert/strict";
import { Given, Then, When, World, setWorldConstructor } from "@cucumber/cucumber";
import { runScenario } from "../../src/sim/engine";
import { scenarios } from "../../src/sim/scenarios";
import type { ScenarioConfig, SimulationResult } from "../../src/sim/types";
import { withWorkflow } from "../../src/sim/workflow";

class FlowLabWorld extends World {
  config?: ScenarioConfig;
  result?: SimulationResult;
  secondResult?: SimulationResult;
  baseline?: SimulationResult;
  workflowError?: string;
  workflowBeforeEdit?: ScenarioConfig;
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

Then("a daily entry with no movements is still shown with zero counts", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const noMovementEntry = result.dailyLog.find((entry) => entry.movements.every((movement) => movement.count === 0));
  assert.ok(noMovementEntry, "Expected at least one day without movement");
  assert.ok(noMovementEntry.movements.every((movement) => movement.count === 0));
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
