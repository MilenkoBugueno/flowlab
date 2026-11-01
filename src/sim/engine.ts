import { between, createSeededRandom, deriveSeed, poisson } from "./random";
import type {
  ActiveStage,
  CapacityAssistance,
  DailyLogEntry,
  DailyMovement,
  DailySnapshot,
  Feature,
  FlowEvent,
  ItemStatus,
  Metrics,
  OperatingAssumptions,
  ScenarioConfig,
  SimulationResult,
  Stage,
  WorkItem,
  WorkItemType,
} from "./types";
import { activeStages, handoffStages, nextActiveStage } from "./workflow";

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

export function feedbackBugEffortFor(baseBugEffort: number, feedbackDelayEffortFactor: number, developedAt: number, testedAt: number): { effort: number; delayDays: number } {
  const delayDays = Math.max(0, testedAt - developedAt);
  return { effort: baseBugEffort + feedbackDelayEffortFactor * delayDays, delayDays };
}

export function runScenario(config: ScenarioConfig, seed = 42): SimulationResult {
  const stages = config.workflow.stages;
  const entryStage = stages[0];
  const exitStage = stages.at(-1);
  if (!entryStage || !exitStage) throw new Error("A workflow needs an entry and an exit state.");
  const active = activeStages(config.workflow);
  const handoffs = new Set(handoffStages(config.workflow));
  const developmentStage = active[0];
  const testStage = active.at(-1);
  const demandRandom = createSeededRandom(seed);
  const effortRandom = createSeededRandom(deriveSeed(seed, 0x9e3779b9));
  const featureRandom = createSeededRandom(deriveSeed(seed, 0xc2b2ae35));
  const items: WorkItem[] = [];
  const features: Feature[] = [];
  const events: FlowEvent[] = [];
  const snapshots: DailySnapshot[] = [];
  const dailyLog: DailyLogEntry[] = [];
  let itemNumber = 0;
  let featureNumber = 0;
  let feedbackArrivals = 0;

  const record = (day: number, type: FlowEvent["type"], item: WorkItem, stage: Stage) => {
    events.push({ day, type, itemId: item.id, stage });
  };

  const recordMovement = (day: number, from: Stage | "External", to: Stage) => {
    const movement = dailyLog[day].movements.find((candidate) => candidate.from === from && candidate.to === to);
    if (!movement) throw new Error(`Movement ${from} → ${to} is not part of the configured workflow.`);
    movement.count += 1;
  };

  const createItem = (
    day: number,
    type: WorkItemType,
    initial: boolean,
    initialStage = entryStage,
    options: {
      title?: string;
      plannedEffortOverrides?: Partial<Record<ActiveStage, number>>;
      featureId?: string;
      featureTitle?: string;
      originatingPbiId?: string;
      feedbackDelayDays?: number;
    } = {},
  ): WorkItem => {
    const ordinal = ++itemNumber;
    const initialStageIndex = stages.indexOf(initialStage);
    const plannedStages = active.filter((stage) => stages.indexOf(stage) >= initialStageIndex);
    const plannedEffort = Object.fromEntries(plannedStages.map((stage) => {
      const range = config.serviceEffort[stage] ?? { min: 0.75, max: 1.25 };
      return [stage, options.plannedEffortOverrides?.[stage] ?? between(range.min, range.max, effortRandom)];
    }));
    const totalEffort = Object.values(plannedEffort).reduce((total, effort) => total + effort, 0);
    const typeLabel = type === "PBI" ? "Product backlog item" : "Bug";
    return {
      id: `${type}-${String(ordinal).padStart(3, "0")}`,
      title: options.title ?? `${typeLabel} ${ordinal}`,
      type,
      initial,
      arrivedAt: day,
      stage: initialStage,
      status: "waiting",
      active: false,
      progressPercent: 0,
      totalEffort,
      completedEffort: 0,
      plannedEffort,
      effortRemaining: active.includes(initialStage) ? (plannedEffort[initialStage] ?? 0) : 0,
      enteredAt: { [initialStage]: day },
      startedAt: {},
      featureId: options.featureId,
      featureTitle: options.featureTitle,
      originatingPbiId: options.originatingPbiId,
      feedbackDelayDays: options.feedbackDelayDays,
      history: [{
        day,
        stage: initialStage,
        active: false,
        progressPercent: 0,
      }],
    };
  };

  const setEffort = (item: WorkItem, stage: ActiveStage) => {
    item.effortRemaining = item.plannedEffort[stage] ?? 0;
  };

  const enter = (day: number, item: WorkItem, stage: Stage) => {
    const from = item.stage;
    item.stage = stage;
    item.status = "waiting";
    item.active = false;
    item.enteredAt[stage] = day;
    if (active.includes(stage)) setEffort(item, stage);
    else item.effortRemaining = 0;
    record(day, "entered-stage", item, stage);
    recordMovement(day, from, stage);
  };

  const complete = (day: number, item: WorkItem, from: Stage) => {
    item.stage = exitStage;
    item.status = "done";
    item.active = false;
    item.progressPercent = 100;
    item.completedAt = day;
    record(day, "completed", item, exitStage);
    recordMovement(day, from, exitStage);
  };

  const featureBacklog = config.featureBacklog ?? { featureCount: 0, minPbisPerFeature: 5, maxPbisPerFeature: 10, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 };
  const featureFor = (item: WorkItem): Feature | undefined => features.find((feature) => feature.id === item.featureId);
  const featureTestGateOpen = (item: WorkItem): boolean => {
    const feature = featureFor(item);
    return !feature || feature.pbiIds.every((pbiId) => items.find((candidate) => candidate.id === pbiId)?.developedAt !== undefined);
  };
  const completionFocusFor = (day: number): Feature | undefined => {
    if (!config.featureFocus || day < config.featureFocus.startDay) return undefined;
    return features.find((feature) => feature.completedAt === undefined);
  };
  const isFocused = (item: WorkItem, focus: Feature | undefined): boolean => !focus || item.featureId === focus.id;

  const canEnter = (target: Stage): boolean => {
    const wipLimit = config.wipLimits?.[target];
    if (wipLimit === undefined) return true;
    const countedItems = items.filter((item) => {
      const isDependencyGatedDevelopment = target === developmentStage
        && item.stage === developmentStage
        && item.status === "blocked"
        && item.type === "PBI"
        && item.featureId !== undefined
        && !featureTestGateOpen(item);
      return item.stage === target && !isDependencyGatedDevelopment;
    });
    return countedItems.length < wipLimit;
  };

  const createFeedbackBug = (day: number, pbi: WorkItem) => {
    if (pbi.feedbackBugId) return;
    const { delayDays: delay, effort: fixEffort } = feedbackBugEffortFor(featureBacklog.baseBugEffort, featureBacklog.feedbackDelayEffortFactor, pbi.developedAt ?? day, day);
    const plannedEffortOverrides = developmentStage ? { [developmentStage]: fixEffort } : {};
    const bug = createItem(day, "Bug", false, entryStage, {
      title: `Fix ${pbi.id}`,
      plannedEffortOverrides,
      featureId: pbi.featureId,
      featureTitle: pbi.featureTitle,
      originatingPbiId: pbi.id,
      feedbackDelayDays: delay,
    });
    items.push(bug);
    pbi.testedAt = day;
    pbi.feedbackBugId = bug.id;
    featureFor(pbi)?.bugIds.push(bug.id);
    feedbackArrivals += 1;
    record(day, "arrival", bug, entryStage);
    recordMovement(day, "External", entryStage);
  };

  const moveBlocked = (day: number, from: ActiveStage, focus: Feature | undefined) => {
    const target = nextStage(from, stages);
    const candidates = items
      .filter((item) => item.stage === from && item.status === "blocked")
      .sort((a, b) => (a.enteredAt[from] ?? 0) - (b.enteredAt[from] ?? 0));
    for (const item of candidates) {
      if (!isFocused(item, focus)) continue;
      if (target === testStage && item.type === "PBI" && !featureTestGateOpen(item)) continue;
      if (target === exitStage) complete(day, item, from);
      else if (canEnter(target)) enter(day, item, target);
    }
  };

  const pullHandoffWork = (day: number, from: Stage, focus: Feature | undefined) => {
    const target = nextStage(from, stages);
    const candidates = items
      .filter((item) => item.stage === from && item.status === "waiting")
      .sort((a, b) => (a.enteredAt[from] ?? 0) - (b.enteredAt[from] ?? 0));
    for (const item of candidates) {
      if (!isFocused(item, focus)) continue;
      if (target === testStage && item.type === "PBI" && !featureTestGateOpen(item)) continue;
      if (target === exitStage) complete(day, item, from);
      else if (canEnter(target)) enter(day, item, target);
    }
  };

  const admitBacklogWork = (day: number, pushAllowance: number, focus: Feature | undefined) => {
    const entryItems = items
      .filter((item) => item.stage === entryStage && isFocused(item, focus))
      .sort((a, b) => a.arrivedAt - b.arrivedAt);
    const firstActive = active[0];
    const pullBased = firstActive !== undefined && config.wipLimits?.[firstActive] !== undefined;
    let remainingAdmissions = pullBased ? Number.POSITIVE_INFINITY : pushAllowance;
    for (const item of entryItems) {
      if (remainingAdmissions <= 0) break;
      if (!firstActive) complete(day, item, entryStage);
      else if (canEnter(firstActive)) {
        enter(day, item, firstActive);
        remainingAdmissions -= 1;
      }
      else break;
    }
  };

  const activateWork = (day: number, stage: ActiveStage, maximumConcurrency: number, focus: Feature | undefined) => {
    const activeCount = concurrentItemCount(items, stage);
    const openSlots = Math.max(0, maximumConcurrency - activeCount);
    const waiting = items
      .filter((item) => item.stage === stage && item.status === "waiting" && isFocused(item, focus))
      .sort((a, b) => (a.enteredAt[stage] ?? 0) - (b.enteredAt[stage] ?? 0));
    for (const item of waiting.slice(0, openSlots)) {
      item.status = "active";
      item.active = true;
      item.startedAt[stage] = day;
      item.firstStartedAt ??= day;
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
        item.completedEffort += effortApplied;
        item.progressPercent = item.totalEffort > 0
          ? Math.min(100, (item.completedEffort / item.totalEffort) * 100)
          : 100;
        capacityApplied += effortApplied;
        if (item.effortRemaining <= 1e-9) {
          item.effortRemaining = 0;
          item.status = "blocked";
          item.active = false;
          if (stage === developmentStage && item.type === "PBI") item.developedAt ??= day;
          if (stage === testStage && item.type === "PBI" && item.featureId) createFeedbackBug(day, item);
          record(day, "blocked", item, stage);
        }
      }
      if (capacityApplied <= 1e-9) return remainingCapacity;
      remainingCapacity -= capacityApplied;
    }
    return 0;
  };

  const recordItemState = (day: number, item: WorkItem) => {
    const state = {
      day,
      stage: item.stage,
      active: item.active,
      progressPercent: item.progressPercent,
      startDate: item.firstStartedAt,
      completionDate: item.completedAt,
    };
    const previous = item.history.at(-1);
    if (
      !previous
      || previous.stage !== state.stage
      || previous.active !== state.active
      || previous.progressPercent !== state.progressPercent
      || previous.startDate !== state.startDate
      || previous.completionDate !== state.completionDate
    ) item.history.push(state);
  };

  const updateFeatureCompletion = () => {
    for (const feature of features) {
      if (feature.completedAt !== undefined) continue;
      const linkedItems = [...feature.pbiIds, ...feature.bugIds].map((id) => items.find((item) => item.id === id));
      if (feature.pbiIds.length && feature.pbiIds.every((id) => items.find((item) => item.id === id)?.feedbackBugId) && linkedItems.every((item) => item?.completedAt !== undefined)) {
        feature.completedAt = Math.max(...linkedItems.map((item) => item?.completedAt ?? 0));
      }
    }
  };

  for (let index = 0; index < featureBacklog.featureCount; index += 1) {
    const ordinal = ++featureNumber;
    const feature: Feature = { id: `FEATURE-${String(ordinal).padStart(3, "0")}`, title: `Feature ${String(ordinal).padStart(3, "0")}`, pbiIds: [], bugIds: [] };
    features.push(feature);
    const pbiCount = featureBacklog.minPbisPerFeature + Math.floor(featureRandom.next() * (featureBacklog.maxPbisPerFeature - featureBacklog.minPbisPerFeature + 1));
    for (let pbiIndex = 0; pbiIndex < pbiCount; pbiIndex += 1) {
      const pbi = createItem(0, "PBI", true, entryStage, { title: `${feature.title} · PBI ${pbiIndex + 1}`, featureId: feature.id, featureTitle: feature.title });
      items.push(pbi);
      feature.pbiIds.push(pbi.id);
    }
  }

  const initialInventory = config.initialInventory ?? { [entryStage]: config.initialBacklog ?? { pbiCount: 0, bugCount: 0 } };
  for (const stage of stages.slice(0, -1)) {
    const inventory = initialInventory[stage] ?? { pbiCount: 0, bugCount: 0 };
    for (let index = 0; index < inventory.pbiCount; index += 1) items.push(createItem(0, "PBI", true, stage));
    for (let index = 0; index < inventory.bugCount; index += 1) items.push(createItem(0, "Bug", true, stage));
  }

  for (let day = 0; day < config.horizonDays; day += 1) {
    const featureFocus = completionFocusFor(day);
    dailyLog.push({
      day,
      seed,
      movements: emptyMovements(stages),
      featureFocus: featureFocus && { id: featureFocus.id, title: featureFocus.title },
    });
    feedbackArrivals = 0;
    const pushAllowance = poisson(config.arrivalRatePerDay, demandRandom) + (config.batchDays.includes(day) ? config.batchSize : 0);

    if (featureFocus) {
      for (const item of items) {
        if (item.status === "active" && !isFocused(item, featureFocus)) {
          item.status = "waiting";
          item.active = false;
        }
      }
    }

    // Stable daily event order: completed work moves, policies are implicit in rates,
    // admissions/pulls happen, then available stages begin work.
    [...stages.slice(1, -1)].reverse().forEach((stage) => {
      if (handoffs.has(stage)) pullHandoffWork(day, stage, featureFocus);
      else if (active.includes(stage)) moveBlocked(day, stage, featureFocus);
    });
    admitBacklogWork(day, pushAllowance, featureFocus);
    active.forEach((stage) => {
      const maximumConcurrency = config.operatingAssumptions?.[stage]?.maximumConcurrency ?? 16;
      activateWork(day, stage, maximumConcurrency, featureFocus);
    });
    const operatingCapacity = active.map((stage) => {
      const baseCapacity = processingRateFor(stage, day, config);
      const concurrentItems = concurrentItemCount(items, stage);
      const assumptions = config.operatingAssumptions?.[stage] ?? { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 };
      const { effectiveCapacity, taskSwitchingLoss } = effectiveCapacityFor(baseCapacity, concurrentItems, assumptions);
      return { stage, concurrentItems, baseCapacity, effectiveCapacity, taskSwitchingLoss };
    });
    const unusedCapacity = Object.fromEntries(
      operatingCapacity.map(({ stage, effectiveCapacity }) => [stage, processWork(day, stage, effectiveCapacity)]),
    );
    const capacityAssistance: CapacityAssistance[] = [];
    if (featureFocus && developmentStage && testStage && developmentStage !== testStage) {
      const focusedDevelopmentWork = items.some((item) => (
        item.featureId === featureFocus.id
        && item.stage === developmentStage
        && (item.status === "waiting" || item.status === "active")
      ));
      const focusedTestWork = items.some((item) => (
        item.featureId === featureFocus.id
        && item.stage === testStage
        && item.status === "active"
      ));
      if (!focusedDevelopmentWork && focusedTestWork && unusedCapacity[developmentStage] > 0) {
        const offeredCapacity = unusedCapacity[developmentStage];
        const unusedAssistance = processWork(day, testStage, offeredCapacity);
        const appliedCapacity = offeredCapacity - unusedAssistance;
        unusedCapacity[developmentStage] = unusedAssistance;
        if (appliedCapacity > 0) {
          capacityAssistance.push({
            from: developmentStage,
            to: testStage,
            capacity: appliedCapacity,
            effectiveness: 1,
            reason: "completion-focus",
            featureId: featureFocus.id,
          });
        }
      }
    }
    const effectiveness = config.wipAssistanceEffectiveness ?? 0.75;
    for (const sourceStage of active) {
      if (config.wipLimits?.[sourceStage] === undefined || unusedCapacity[sourceStage] <= 0) continue;
      const targetStage = nextActiveStage(sourceStage, config.workflow);
      if (!targetStage) continue;
      const offeredCapacity = unusedCapacity[sourceStage] * effectiveness;
      const unusedAssistance = processWork(day, targetStage, offeredCapacity);
      const appliedCapacity = offeredCapacity - unusedAssistance;
      if (appliedCapacity > 0) {
        capacityAssistance.push({ from: sourceStage, to: targetStage, capacity: appliedCapacity, effectiveness, reason: "wip-assistance" });
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
    updateFeatureCompletion();
    items.forEach((item) => recordItemState(day, item));
    snapshots.push({
      day,
      states,
      active: activeCounts,
      waiting,
      arrivals: feedbackArrivals,
      completions: items.filter((item) => item.completedAt === day).length,
      externalBacklog: 0,
      capacityAssistance,
      operatingCapacity,
      featureFocus: featureFocus && { id: featureFocus.id, title: featureFocus.title },
    });
  }

  return { config, seed, items, features, events, snapshots, dailyLog, metrics: calculateMetrics(items, snapshots, config, features) };
}

export function calculateMetrics(items: WorkItem[], snapshots: DailySnapshot[], config: ScenarioConfig, features: Feature[] = []): Metrics {
  const stages = config.workflow.stages;
  const exitStage = stages.at(-1) ?? "Done";
  const active = activeStages(config.workflow);
  const reviewStage = stages.find((stage) => stage.toLocaleLowerCase().includes("review")) ?? active.at(-1);
  const completed = items.filter((item) => item.completedAt !== undefined && item.completedAt >= config.warmupDays);
  const cycleTimes = completed.flatMap((item) => {
    return item.firstStartedAt === undefined ? [] : [(item.completedAt ?? 0) - item.firstStartedAt];
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
    completedFeatures: features.filter((feature) => feature.completedAt !== undefined && feature.completedAt >= config.warmupDays).length,
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
