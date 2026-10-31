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
    for (const count of Object.values(entry.movements)) assert.ok(Number.isInteger(count) && count >= 0);
  }
});

Then("movements into the workflow are recorded as External to Ready", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.equal(
    result.dailyLog.reduce((total, entry) => total + entry.movements["external-to-ready"], 0),
    result.items.length,
  );
});

Then("movements through the workflow are recorded as Ready to Development, Development to Review, and Review to Test", function (this: FlowLabWorld) {
  const result = resultFor(this);
  assert.ok(result.dailyLog.some((entry) => entry.movements["ready-to-development"] > 0));
  assert.ok(result.dailyLog.some((entry) => entry.movements["development-to-review"] > 0));
  assert.ok(result.dailyLog.some((entry) => entry.movements["review-to-test"] > 0));
});

Then("completed work is recorded as Test to Done", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const completions = result.items.filter((item) => item.completedAt !== undefined).length;
  assert.equal(result.dailyLog.reduce((total, entry) => total + entry.movements["test-to-done"], 0), completions);
});

Then("a daily entry with no movements is still shown with zero counts", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const noMovementEntry = result.dailyLog.find((entry) => Object.values(entry.movements).every((count) => count === 0));
  assert.ok(noMovementEntry, "Expected at least one day without movement");
  assert.deepEqual(noMovementEntry.movements, {
    "external-to-ready": 0,
    "ready-to-development": 0,
    "development-to-review": 0,
    "review-to-test": 0,
    "test-to-done": 0,
  });
});

Then("the sum of all daily External to Ready movements equals the number of arrived items", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const arrivals = result.snapshots.reduce((total, snapshot) => total + snapshot.arrivals, 0);
  const loggedArrivals = result.dailyLog.reduce((total, entry) => total + entry.movements["external-to-ready"], 0);
  assert.equal(loggedArrivals, arrivals);
});

Then("the sum of all daily Test to Done movements equals the number of completed items", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const completions = result.snapshots.reduce((total, snapshot) => total + snapshot.completions, 0);
  const loggedCompletions = result.dailyLog.reduce((total, entry) => total + entry.movements["test-to-done"], 0);
  assert.equal(loggedCompletions, completions);
});

Then("the daily log movements reproduce the change in each state between consecutive daily snapshots", function (this: FlowLabWorld) {
  const result = resultFor(this);
  const prior = { ready: 0, development: 0, review: 0, test: 0, done: 0 };
  for (const [day, snapshot] of result.snapshots.entries()) {
    const movements = result.dailyLog[day].movements;
    const changes = {
      ready: movements["external-to-ready"] - movements["ready-to-development"],
      development: movements["ready-to-development"] - movements["development-to-review"],
      review: movements["development-to-review"] - movements["review-to-test"],
      test: movements["review-to-test"] - movements["test-to-done"],
      done: movements["test-to-done"],
    };
    for (const stage of Object.keys(prior) as Array<keyof typeof prior>) {
      assert.equal(snapshot.states[stage] - prior[stage], changes[stage], `State reconciliation failed on day ${day} for ${stage}`);
      prior[stage] = snapshot.states[stage];
    }
  }
});
