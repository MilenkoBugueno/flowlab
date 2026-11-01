import { between, createSeededRandom, deriveSeed, poisson } from "./random";
import type {
  ActiveStage,
  DailyLogEntry,
  DailyMovement,
  DailySnapshot,
  FlowEvent,
  ItemStatus,
  Metrics,
  OperatingAssumptions,
  ScenarioConfig,
  SimulationResult,
  Stage,
  WorkItem,
} from "./types";
import { activeStages } from "./workflow";

const emptyStages = (stages: Stage[]): Record<Stage, number> => Object.fromEntries(stages.map((stage) => [stage, 0]));
const emptyActive = (stages: ActiveStage[]): Record<ActiveStage, number> => Object.fromEntries(stages.map((stage) => [stage, 0]));

function emptyMovements(stages: Stage[]): DailyMovement[] {
  return [
    { from: "External", to: stages[0], count: 0 },
    ...stages.slice(0, -1).map((from, index) => ({ from, to: stages[index + 1], count: 0 })),
  ];
}

function percentile(values: number[], proportion: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * proportion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function nextStage(stage: ActiveStage, stages: Stage[]): Stage {
  const next = stages[stages.indexOf(stage) + 1];
  if (!next) throw new Error(`No downstream state is configured for ${stage}.`);
  return next;
}

export function processingRateFor(stage: ActiveStage, day: number, config: ScenarioConfig): number {
  let rate = config.baseRates[stage] ?? 1;
  if (config.incident && config.incident.stage === stage && day >= config.incident.startDay && day <= config.incident.endDay) {
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

function concurrentItemCount(items: WorkItem[], stage: ActiveStage): number {
  return items.filter((item) => item.stage === stage && item.status === "active").length;
}

export function effectiveCapacityFor(baseCapacity: number, concurrentItems: number, assumptions: OperatingAssumptions): { effectiveCapacity: number; taskSwitchingLoss: number } {
  const overloadFraction = concurrentItems > assumptions.focusWip
    ? (concurrentItems - assumptions.focusWip) / concurrentItems
    : 0;
  const taskSwitchingLoss = baseCapacity * assumptions.taskSwitchingLossRatio * overloadFraction;
  return { effectiveCapacity: baseCapacity - taskSwitchingLoss, taskSwitchingLoss };
}

function canEnter(items: WorkItem[], target: ActiveStage, config: ScenarioConfig): boolean {
  const wipLimit = config.wipLimits?.[target];
  const withinWipLimit = wipLimit === undefined || stageCount(items, target) < wipLimit;
  return withinWipLimit;
}

export function runScenario(config: ScenarioConfig, seed = 42): SimulationResult {
  const stages = config.workflow.stages;
  const entryStage = stages[0];
  const exitStage = stages.at(-1);
  if (!entryStage || !exitStage) throw new Error("A workflow needs an entry and an exit state.");
  const active = activeStages(config.workflow);
  const demandRandom = createSeededRandom(seed);
  const effortRandom = createSeededRandom(deriveSeed(seed, 0x9e3779b9));
  const items: WorkItem[] = [];
  const events: FlowEvent[] = [];
  const snapshots: DailySnapshot[] = [];
  const dailyLog: DailyLogEntry[] = [];
  let itemNumber = 0;

  const record = (day: number, type: FlowEvent["type"], item: WorkItem, stage: Stage) => {
    events.push({ day, type, itemId: item.id, stage });
  };

  const recordMovement = (day: number, from: Stage | "External", to: Stage) => {
    const movement = dailyLog[day].movements.find((candidate) => candidate.from === from && candidate.to === to);
    if (!movement) throw new Error(`Movement ${from} → ${to} is not part of the configured workflow.`);
    movement.count += 1;
  };

  const setEffort = (item: WorkItem, stage: ActiveStage) => {
    const range = config.serviceEffort[stage] ?? { min: 0.75, max: 1.25 };
    item.effortRemaining = between(range.min, range.max, effortRandom);
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

  const complete = (day: number, item: WorkItem, from: Stage) => {
    item.stage = exitStage;
    item.status = "done";
    item.completedAt = day;
    record(day, "completed", item, exitStage);
    recordMovement(day, from, exitStage);
  };

  const moveBlocked = (day: number, from: ActiveStage) => {
    const target = nextStage(from, stages);
    const candidates = items
      .filter((item) => item.stage === from && item.status === "blocked")
      .sort((a, b) => (a.enteredAt[from] ?? 0) - (b.enteredAt[from] ?? 0));
    for (const item of candidates) {
      if (target === exitStage) complete(day, item, from);
      else if (canEnter(items, target, config)) enter(day, item, target);
    }
  };

  const pullEntryWork = (day: number) => {
    const entryItems = items.filter((item) => item.stage === entryStage).sort((a, b) => a.arrivedAt - b.arrivedAt);
    const firstActive = active[0];
    for (const item of entryItems) {
      if (!firstActive) complete(day, item, entryStage);
      else if (canEnter(items, firstActive, config)) enter(day, item, firstActive);
      else break;
    }
  };

  const activateWork = (day: number, stage: ActiveStage, maximumConcurrency: number) => {
    const activeCount = concurrentItemCount(items, stage);
    const openSlots = Math.max(0, maximumConcurrency - activeCount);
    const waiting = items
      .filter((item) => item.stage === stage && item.status === "waiting")
      .sort((a, b) => (a.enteredAt[stage] ?? 0) - (b.enteredAt[stage] ?? 0));
    for (const item of waiting.slice(0, openSlots)) {
      item.status = "active";
      item.startedAt[stage] = day;
      record(day, "started", item, stage);
    }
  };

  const processWork = (day: number, stage: ActiveStage, availableCapacity: number): number => {
    let remainingCapacity = availableCapacity;
    while (remainingCapacity > 1e-9) {
      const currentlyActive = items.filter((item) => item.stage === stage && item.status === "active");
      if (!currentlyActive.length) return remainingCapacity;
      const equalShare = remainingCapacity / currentlyActive.length;
      let capacityApplied = 0;
      for (const item of currentlyActive) {
        const effortApplied = Math.min(item.effortRemaining, equalShare);
        item.effortRemaining -= effortApplied;
        capacityApplied += effortApplied;
        if (item.effortRemaining <= 1e-9) {
          item.effortRemaining = 0;
          item.status = "blocked";
          record(day, "blocked", item, stage);
        }
      }
      if (capacityApplied <= 1e-9) return remainingCapacity;
      remainingCapacity -= capacityApplied;
    }
    return 0;
  };

  for (let day = 0; day < config.horizonDays; day += 1) {
    dailyLog.push({ day, seed, movements: emptyMovements(stages) });
    const arrivals = poisson(config.arrivalRatePerDay, demandRandom) + (config.batchDays.includes(day) ? config.batchSize : 0);
    for (let arrival = 0; arrival < arrivals; arrival += 1) {
      const item: WorkItem = {
        id: `FL-${String(++itemNumber).padStart(3, "0")}`,
        arrivedAt: day,
        stage: entryStage,
        status: "waiting",
        effortRemaining: 0,
        enteredAt: { [entryStage]: day },
        startedAt: {},
      };
      items.push(item);
      record(day, "arrival", item, entryStage);
      recordMovement(day, "External", entryStage);
    }

    // Stable daily event order: completed work moves, policies are implicit in rates,
    // admissions/pulls happen, then available stages begin work.
    [...active].reverse().forEach((stage) => moveBlocked(day, stage));
    pullEntryWork(day);
    active.forEach((stage) => {
      const maximumConcurrency = config.operatingAssumptions?.[stage]?.maximumConcurrency ?? 16;
      activateWork(day, stage, maximumConcurrency);
    });
    const operatingCapacity = active.map((stage) => {
      const baseCapacity = processingRateFor(stage, day, config);
      const concurrentItems = concurrentItemCount(items, stage);
      const assumptions = config.operatingAssumptions?.[stage] ?? { focusWip: 2, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 };
      const { effectiveCapacity, taskSwitchingLoss } = effectiveCapacityFor(baseCapacity, concurrentItems, assumptions);
      return { stage, concurrentItems, baseCapacity, effectiveCapacity, taskSwitchingLoss };
    });
    const unusedCapacity = Object.fromEntries(
      operatingCapacity.map(({ stage, effectiveCapacity }) => [stage, processWork(day, stage, effectiveCapacity)]),
    );
    const capacityAssistance = [];
    const effectiveness = config.wipAssistanceEffectiveness ?? 0.75;
    for (const sourceStage of active) {
      if (config.wipLimits?.[sourceStage] === undefined || unusedCapacity[sourceStage] <= 0) continue;
      const targetStage = nextStage(sourceStage, stages);
      if (!active.includes(targetStage)) continue;
      const offeredCapacity = unusedCapacity[sourceStage] * effectiveness;
      const unusedAssistance = processWork(day, targetStage, offeredCapacity);
      const appliedCapacity = offeredCapacity - unusedAssistance;
      if (appliedCapacity > 0) {
        capacityAssistance.push({ from: sourceStage, to: targetStage, capacity: appliedCapacity, effectiveness });
      }
    }

    const states = emptyStages(stages);
    const activeCounts = emptyActive(active);
    const waiting = emptyStages(stages);
    for (const item of items) {
      states[item.stage] += 1;
      if (item.status === "active" && active.includes(item.stage)) activeCounts[item.stage] += 1;
      if (item.status !== "active" && item.stage !== exitStage) waiting[item.stage] += 1;
    }
    snapshots.push({
      day,
      states,
      active: activeCounts,
      waiting,
      arrivals,
      completions: items.filter((item) => item.completedAt === day).length,
      externalBacklog: 0,
      capacityAssistance,
      operatingCapacity,
    });
  }

  return { config, seed, items, events, snapshots, dailyLog, metrics: calculateMetrics(items, snapshots, config) };
}

export function calculateMetrics(items: WorkItem[], snapshots: DailySnapshot[], config: ScenarioConfig): Metrics {
  const stages = config.workflow.stages;
  const exitStage = stages.at(-1) ?? "Done";
  const active = activeStages(config.workflow);
  const reviewStage = stages.find((stage) => stage.toLocaleLowerCase().includes("review")) ?? active.at(-1);
  const completed = items.filter((item) => item.completedAt !== undefined && item.completedAt >= config.warmupDays);
  const cycleTimes = completed.flatMap((item) => {
    const firstActiveStart = active
      .map((stage) => item.startedAt[stage])
      .filter((day): day is number => day !== undefined)
      .sort((left, right) => left - right)[0];
    return firstActiveStart === undefined ? [] : [(item.completedAt ?? 0) - firstActiveStart];
  });
  const measuredDays = config.horizonDays - config.warmupDays;
  const observed = snapshots.filter((snapshot) => snapshot.day >= config.warmupDays);
  const wip = observed.map((snapshot) => stages.filter((stage) => stage !== exitStage).reduce((total, stage) => total + snapshot.states[stage], 0));
  const reviewQueueDays = reviewStage ? observed.reduce((total, snapshot) => total + snapshot.waiting[reviewStage], 0) : 0;
  const totalQueueDays = observed.reduce(
    (total, snapshot) => total + stages.filter((stage) => stage !== exitStage).reduce((sum, stage) => sum + snapshot.waiting[stage], 0),
    0,
  );
  const totalTaskSwitchingLoss = observed.reduce(
    (total, snapshot) => total + (snapshot.operatingCapacity ?? []).reduce((sum, capacity) => sum + capacity.taskSwitchingLoss, 0),
    0,
  );
  const throughputPerWeek = measuredDays ? (completed.length / measuredDays) * 5 : 0;
  const meanCycle = cycleTimes.length ? cycleTimes.reduce((total, value) => total + value, 0) / cycleTimes.length : null;
  return {
    completedItems: completed.length,
    throughputPerWeek,
    medianCycleTime: percentile(cycleTimes, 0.5),
    p85CycleTime: percentile(cycleTimes, 0.85),
    maxReviewWip: reviewStage ? Math.max(0, ...snapshots.map((snapshot) => snapshot.states[reviewStage])) : 0,
    reviewQueueDays,
    totalQueueDays,
    meanWip: wip.length ? wip.reduce((total, value) => total + value, 0) / wip.length : 0,
    totalTaskSwitchingLoss,
    littlesLawEstimate: meanCycle === null ? null : (throughputPerWeek / 5) * meanCycle,
  };
}

export function describeStatus(status: ItemStatus): string {
  return status === "blocked" ? "waiting to move downstream" : status;
}
