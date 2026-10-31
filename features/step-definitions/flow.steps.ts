import assert from "node:assert/strict";
import { Given, Then, When, World, setWorldConstructor } from "@cucumber/cucumber";
import { runScenario } from "../../src/sim/engine";
import { scenarios } from "../../src/sim/scenarios";
import type { ScenarioConfig, SimulationResult } from "../../src/sim/types";

class FlowLabWorld extends World {
  config?: ScenarioConfig;
  result?: SimulationResult;
  secondResult?: SimulationResult;
  baseline?: SimulationResult;
}

setWorldConstructor(FlowLabWorld);

function resultFor(world: FlowLabWorld): SimulationResult {
  assert.ok(world.result, "Expected a completed simulation");
  return world.result;
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
  const atStart = result.snapshots[startDay].states.review;
  const atEnd = result.snapshots[endDay].states.review;
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
  assert.ok(result.snapshots.every((snapshot) => snapshot.states.review <= limit));
});

Then("constrained work remains visible upstream", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.snapshots.some((snapshot) => snapshot.states.ready > 0 || snapshot.states.development >= 6));
});
