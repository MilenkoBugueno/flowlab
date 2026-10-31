import { between, createSeededRandom, poisson } from "./random";
import type {
  ActiveStage,
  DailyLogEntry,
  DailySnapshot,
  FlowEvent,
  ItemStatus,
  Metrics,
  MovementRoute,
  ScenarioConfig,
  SimulationResult,
  Stage,
  WorkItem,
} from "./types";

const activeStages: ActiveStage[] = ["development", "review", "test"];
const emptyStages = (): Record<Stage, number> => ({ ready: 0, development: 0, review: 0, test: 0, done: 0 });
const emptyActive = (): Record<ActiveStage, number> => ({ development: 0, review: 0, test: 0 });
const emptyMovements = (): Record<MovementRoute, number> => ({
  "external-to-ready": 0,
  "ready-to-development": 0,
  "development-to-review": 0,
  "review-to-test": 0,
  "test-to-done": 0,
});

function movementRoute(from: Stage | "external", to: Stage): MovementRoute {
  return `${from}-to-${to}` as MovementRoute;
}

function percentile(values: number[], proportion: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * proportion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function nextStage(stage: ActiveStage): ActiveStage | "done" {
  if (stage === "development") return "review";
  if (stage === "review") return "test";
  return "done";
}

function rateFor(stage: ActiveStage, day: number, config: ScenarioConfig): number {
  let rate = config.baseRates[stage];
  if (config.incident.stage === stage && day >= config.incident.startDay && day <= config.incident.endDay) {
    rate = config.incident.ratePerDay;
  }
  const swarm = config.swarm;
  if (!swarm || day < swarm.startDay || day >= swarm.startDay + swarm.durationDays) return rate;
  if (stage === swarm.sourceStage) return Math.max(0, rate - swarm.capacityShift);
  if (stage === swarm.targetStage) {
    const effectiveness = day === swarm.startDay ? swarm.rampUpEffectiveness : 1;
    return rate + swarm.capacityShift * effectiveness;
  }
  return rate;
}

function stageCount(items: WorkItem[], stage: Stage): number {
  return items.filter((item) => item.stage === stage).length;
}

function canEnter(items: WorkItem[], target: ActiveStage, config: ScenarioConfig): boolean {
  const limit = config.wipLimits?.[target];
  return limit === undefined || stageCount(items, target) < limit;
}

export function runScenario(config: ScenarioConfig, seed = 42): SimulationResult {
  const random = createSeededRandom(seed);
  const items: WorkItem[] = [];
  const events: FlowEvent[] = [];
  const snapshots: DailySnapshot[] = [];
  const dailyLog: DailyLogEntry[] = [];
  let itemNumber = 0;

  const record = (day: number, type: FlowEvent["type"], item: WorkItem, stage: Stage) => {
    events.push({ day, type, itemId: item.id, stage });
  };

  const recordMovement = (day: number, from: Stage | "external", to: Stage) => {
    dailyLog[day].movements[movementRoute(from, to)] += 1;
  };

  const setEffort = (item: WorkItem, stage: ActiveStage) => {
    const range = config.serviceEffort[stage];
    item.effortRemaining = between(range.min, range.max, random);
  };

  const enter = (day: number, item: WorkItem, stage: ActiveStage) => {
    const from = item.stage;
    item.stage = stage;
    item.status = "waiting";
    item.enteredAt[stage] = day;
    setEffort(item, stage);
    record(day, "entered-stage", item, stage);
    recordMovement(day, from, stage);
  };

  const moveBlocked = (day: number, from: ActiveStage) => {
    const target = nextStage(from);
    const candidates = items
      .filter((item) => item.stage === from && item.status === "blocked")
      .sort((a, b) => (a.enteredAt[from] ?? 0) - (b.enteredAt[from] ?? 0));
    for (const item of candidates) {
      if (target === "done") {
        item.stage = "done";
        item.status = "done";
        item.completedAt = day;
        record(day, "completed", item, "done");
        recordMovement(day, from, "done");
      } else if (canEnter(items, target, config)) {
        enter(day, item, target);
      }
    }
  };

  const pullReadyWork = (day: number) => {
    const readyItems = items.filter((item) => item.stage === "ready").sort((a, b) => a.arrivedAt - b.arrivedAt);
    for (const item of readyItems) {
      if (!canEnter(items, "development", config)) break;
      enter(day, item, "development");
    }
  };

  const startWork = (day: number, stage: ActiveStage) => {
    if (items.some((item) => item.stage === stage && item.status === "active")) return;
    const next = items
      .filter((item) => item.stage === stage && item.status === "waiting")
      .sort((a, b) => (a.enteredAt[stage] ?? 0) - (b.enteredAt[stage] ?? 0))[0];
    if (!next) return;
    next.status = "active";
    next.startedAt[stage] = day;
    record(day, "started", next, stage);
  };

  const processWork = (day: number, stage: ActiveStage) => {
    const active = items.find((item) => item.stage === stage && item.status === "active");
    if (!active) return;
    active.effortRemaining -= rateFor(stage, day, config);
    if (active.effortRemaining > 0) return;
    active.effortRemaining = 0;
    active.status = "blocked";
    record(day, "blocked", active, stage);
  };

  for (let day = 0; day < config.horizonDays; day += 1) {
    dailyLog.push({ day, seed, movements: emptyMovements() });
    const arrivals = poisson(config.arrivalRatePerDay, random) + (config.batchDays.includes(day) ? config.batchSize : 0);
    for (let arrival = 0; arrival < arrivals; arrival += 1) {
      const item: WorkItem = {
        id: `FL-${String(++itemNumber).padStart(3, "0")}`,
        arrivedAt: day,
        stage: "ready",
        status: "waiting",
        effortRemaining: 0,
        enteredAt: { ready: day },
        startedAt: {},
      };
      items.push(item);
      record(day, "arrival", item, "ready");
      recordMovement(day, "external", "ready");
    }

    // Stable daily event order: completed work moves, policies are implicit in rates,
    // admissions/pulls happen, then available stages begin work.
    moveBlocked(day, "test");
    moveBlocked(day, "review");
    moveBlocked(day, "development");
    pullReadyWork(day);
    activeStages.forEach((stage) => startWork(day, stage));
    activeStages.forEach((stage) => processWork(day, stage));

    const states = emptyStages();
    const active = emptyActive();
    const waiting = emptyStages();
    for (const item of items) {
      states[item.stage] += 1;
      if (item.status === "active" && item.stage !== "ready" && item.stage !== "done") active[item.stage] += 1;
      if (item.status !== "active" && item.stage !== "done") waiting[item.stage] += 1;
    }
    snapshots.push({
      day,
      states,
      active,
      waiting,
      arrivals,
      completions: items.filter((item) => item.completedAt === day).length,
      externalBacklog: 0,
    });
  }

  return { config, seed, items, events, snapshots, dailyLog, metrics: calculateMetrics(items, snapshots, config) };
}

export function calculateMetrics(items: WorkItem[], snapshots: DailySnapshot[], config: ScenarioConfig): Metrics {
  const completed = items.filter((item) => item.completedAt !== undefined && item.completedAt >= config.warmupDays);
  const cycleTimes = completed.map((item) => (item.completedAt ?? 0) - item.arrivedAt);
  const measuredDays = config.horizonDays - config.warmupDays;
  const observed = snapshots.filter((snapshot) => snapshot.day >= config.warmupDays);
  const wip = observed.map((snapshot) => snapshot.states.ready + snapshot.states.development + snapshot.states.review + snapshot.states.test);
  const reviewQueueDays = observed.reduce((total, snapshot) => total + snapshot.waiting.review, 0);
  const totalQueueDays = observed.reduce(
    (total, snapshot) => total + snapshot.waiting.ready + snapshot.waiting.development + snapshot.waiting.review + snapshot.waiting.test,
    0,
  );
  const throughputPerWeek = measuredDays ? (completed.length / measuredDays) * 5 : 0;
  const meanCycle = cycleTimes.length ? cycleTimes.reduce((total, value) => total + value, 0) / cycleTimes.length : null;
  return {
    completedItems: completed.length,
    throughputPerWeek,
    medianCycleTime: percentile(cycleTimes, 0.5),
    p85CycleTime: percentile(cycleTimes, 0.85),
    maxReviewWip: Math.max(0, ...snapshots.map((snapshot) => snapshot.states.review)),
    reviewQueueDays,
    totalQueueDays,
    meanWip: wip.length ? wip.reduce((total, value) => total + value, 0) / wip.length : 0,
    littlesLawEstimate: meanCycle === null ? null : (throughputPerWeek / 5) * meanCycle,
  };
}

export function describeStatus(status: ItemStatus): string {
  return status === "blocked" ? "waiting to move downstream" : status;
}
