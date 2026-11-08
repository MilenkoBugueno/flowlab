import { between, createSeededRandom, deriveSeed, poisson } from "./random";
import { configForProjectDay } from "./project";
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
import { activeStages, handoffStages } from "./workflow";

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

/** Keep same-day queue ties deterministic without grouping work by Feature. */
function compareQueuePosition(first: WorkItem, second: WorkItem): number {
  return first.positionId - second.positionId
    || first.id.localeCompare(second.id, undefined, { numeric: true });
}

function compareBacklogRanking(first: WorkItem, second: WorkItem): number {
  const firstRanking = first.ranking ?? Number.MAX_SAFE_INTEGER;
  const secondRanking = second.ranking ?? Number.MAX_SAFE_INTEGER;
  return firstRanking - secondRanking || compareQueuePosition(first, second);
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

/**
 * Delayed validation also makes the original testing work harder: context has
 * gone stale and changes are more likely to have side-effects. The same factor
 * that sizes a feedback Bug therefore adds effort when work finally enters Test.
 */
export function testingEffortFor(baseTestEffort: number, feedbackDelayEffortFactor: number, developedAt: number, testEnteredAt: number): { effort: number; delayDays: number } {
  const delayDays = Math.max(0, testEnteredAt - developedAt);
  return { effort: baseTestEffort + feedbackDelayEffortFactor * delayDays, delayDays };
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
  const positionRandom = createSeededRandom(deriveSeed(seed, 0x85ebca6b));
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
      ranking?: number;
      originatingPbiId?: string;
      feedbackDelayDays?: number;
    } = {},
  ): WorkItem => {
    const ordinal = ++itemNumber;
    const initialStageIndex = stages.indexOf(initialStage);
    const plannedStages = active.filter((stage) => stages.indexOf(stage) >= initialStageIndex);
    const plannedEffort = Object.fromEntries(plannedStages.map((stage) => {
      const range = configForProjectDay(config, day).config.serviceEffort[stage] ?? { min: 0.75, max: 1.25 };
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
      positionId: positionRandom.next(),
      ranking: options.ranking,
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

  const setEffort = (item: WorkItem, stage: ActiveStage, day: number) => {
    const baseEffort = item.plannedEffort[stage] ?? 0;
    if (stage === testStage && item.developedAt !== undefined) {
      const { effort } = testingEffortFor(baseEffort, featureBacklog.feedbackDelayEffortFactor, item.developedAt, day);
      item.plannedEffort[stage] = effort;
      item.totalEffort += effort - baseEffort;
      item.effortRemaining = effort;
      return;
    }
    item.effortRemaining = baseEffort;
  };

  const enter = (day: number, item: WorkItem, stage: Stage) => {
    const from = item.stage;
    item.stage = stage;
    item.status = "waiting";
    item.active = false;
    item.enteredAt[stage] = day;
    if (active.includes(stage)) setEffort(item, stage, day);
    else item.effortRemaining = 0;
    record(day, "entered-stage", item, stage);
    recordMovement(day, from, stage);
    updateFeatureHandoff(day, item, stage);
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
  const featureTestGateOpen = (item: WorkItem, dayConfig: ScenarioConfig): boolean => {
    // WIP-limited flow pulls each ready item independently; the Feature-wide
    // test gate is a baseline-flow policy, not an additional WIP constraint.
    if (dayConfig.wipLimits !== undefined) return true;
    const feature = featureFor(item);
    return !feature || feature.pbiIds.every((pbiId) => items.find((candidate) => candidate.id === pbiId)?.developedAt !== undefined);
  };
  const updateFeatureHandoff = (day: number, item: WorkItem, stage: Stage) => {
    if (stage !== testStage || item.type !== "PBI" || !item.featureId) return;
    const feature = featureFor(item);
    if (!feature || feature.handoffAt !== undefined) return;
    if (feature.pbiIds.every((pbiId) => items.find((candidate) => candidate.id === pbiId)?.enteredAt[testStage] !== undefined)) {
      feature.handoffAt = day;
    }
  };
  const completionFocusFor = (day: number, dayConfig: ScenarioConfig): Feature | undefined => {
    // Swarming by itself only shares spare capacity. When it is paired with
    // WIP limits and ranking, it also concentrates new admissions and borrowed
    // capacity on the highest-ranked unfinished Feature.
    const hasWipLimits = Object.keys(dayConfig.wipLimits ?? {}).length > 0;
    if (!dayConfig.featureFocus || !dayConfig.backlogRanking || !hasWipLimits || day < dayConfig.featureFocus.startDay) return undefined;
    const unfinished = features.filter((feature) => feature.completedAt === undefined);
    if (dayConfig.backlogRanking) return unfinished.sort((first, second) => first.ranking - second.ranking)[0];
    return unfinished[0];
  };
  const isFocused = (item: WorkItem, focus: Feature | undefined): boolean => !focus || item.featureId === focus.id;
  const compareStagePriority = (stage: Stage, dayConfig: ScenarioConfig, first: WorkItem, second: WorkItem): number => {
    if (dayConfig.backlogRanking) return compareBacklogRanking(first, second);
    return (first.enteredAt[stage] ?? first.arrivedAt) - (second.enteredAt[stage] ?? second.arrivedAt)
      || compareQueuePosition(first, second);
  };

  const canEnter = (target: Stage, dayConfig: ScenarioConfig): boolean => {
    const wipLimit = dayConfig.wipLimits?.[target];
    if (wipLimit === undefined) return true;
    return items.filter((item) => item.stage === target).length < wipLimit;
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
      ranking: pbi.ranking,
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

  const moveBlocked = (day: number, from: ActiveStage, dayConfig: ScenarioConfig) => {
    const target = nextStage(from, stages);
    const candidates = items
      .filter((item) => item.stage === from && item.status === "blocked")
      .sort((first, second) => compareStagePriority(from, dayConfig, first, second));
    for (const item of candidates) {
      if (target === testStage && item.type === "PBI" && !featureTestGateOpen(item, dayConfig)) continue;
      if (target === exitStage) complete(day, item, from);
      else if (canEnter(target, dayConfig)) enter(day, item, target);
    }
  };

  const pullHandoffWork = (day: number, from: Stage, dayConfig: ScenarioConfig) => {
    const target = nextStage(from, stages);
    const candidates = items
      .filter((item) => item.stage === from && item.status === "waiting")
      .sort((first, second) => compareStagePriority(from, dayConfig, first, second));
    for (const item of candidates) {
      if (target === testStage && item.type === "PBI" && !featureTestGateOpen(item, dayConfig)) continue;
      if (target === exitStage) complete(day, item, from);
      else if (canEnter(target, dayConfig)) enter(day, item, target);
    }
  };

  const admitBacklogWork = (day: number, pushAllowance: number, focus: Feature | undefined, dayConfig: ScenarioConfig) => {
    const entryItems = items
      .filter((item) => item.stage === entryStage && isFocused(item, focus))
      .sort((a, b) => dayConfig.backlogRanking
        ? compareBacklogRanking(a, b)
        : a.arrivedAt - b.arrivedAt || compareQueuePosition(a, b));
    const firstActive = active[0];
    const pullBased = firstActive !== undefined && dayConfig.wipLimits?.[firstActive] !== undefined;
    let remainingAdmissions = pullBased ? Number.POSITIVE_INFINITY : pushAllowance;
    for (const item of entryItems) {
      if (remainingAdmissions <= 0) break;
      if (!firstActive) complete(day, item, entryStage);
      else if (canEnter(firstActive, dayConfig)) {
        enter(day, item, firstActive);
        remainingAdmissions -= 1;
      }
      else break;
    }
  };

  const activateWork = (day: number, stage: ActiveStage, maximumConcurrency: number, dayConfig: ScenarioConfig) => {
    const activeCount = concurrentItemCount(items, stage);
    const openSlots = Math.max(0, maximumConcurrency - activeCount);
    const waiting = items
      .filter((item) => item.stage === stage && item.status === "waiting")
      .sort((first, second) => compareStagePriority(stage, dayConfig, first, second));
    for (const item of waiting.slice(0, openSlots)) {
      item.status = "active";
      item.active = true;
      item.startedAt[stage] = day;
      item.firstStartedAt ??= day;
      record(day, "started", item, stage);
    }
  };

  const processWork = (day: number, stage: ActiveStage, availableCapacity: number, eligible: (item: WorkItem) => boolean = () => true): number => {
    let remainingCapacity = availableCapacity;
    while (remainingCapacity > 1e-9) {
      const currentlyActive = items.filter((item) => item.stage === stage && item.status === "active" && eligible(item));
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

  const swarmingTargetFor = (sourceStage: ActiveStage, dayConfig: ScenarioConfig) => {
    const candidates = active
      .filter((stage) => stage !== sourceStage)
      .map((stage) => {
        const activeWork = items.filter((item) => item.stage === stage && item.status === "active");
        const priorityWork = [...activeWork].sort((first, second) => dayConfig.backlogRanking
          ? compareBacklogRanking(first, second)
          : compareStagePriority(stage, dayConfig, first, second))[0];
        return {
          stage,
          activeWork,
          priorityWork,
          remainingEffort: activeWork.reduce((total, item) => total + item.effortRemaining, 0),
          workInStage: items.filter((item) => item.stage === stage && (item.status === "waiting" || item.status === "active")).length,
        };
      })
      .filter((candidate) => candidate.priorityWork !== undefined);

    return candidates.sort((first, second) => {
      if (dayConfig.backlogRanking && first.priorityWork && second.priorityWork) {
        const rankingComparison = compareBacklogRanking(first.priorityWork, second.priorityWork);
        if (rankingComparison !== 0) return rankingComparison;
      }
      return second.workInStage - first.workInStage
        || second.remainingEffort - first.remainingEffort
        || stages.indexOf(second.stage) - stages.indexOf(first.stage);
    })[0];
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
    const feature: Feature = { id: `FEATURE-${String(ordinal).padStart(3, "0")}`, title: `Feature ${String(ordinal).padStart(3, "0")}`, ranking: ordinal, pbiIds: [], bugIds: [] };
    features.push(feature);
    const pbiCount = featureBacklog.minPbisPerFeature + Math.floor(featureRandom.next() * (featureBacklog.maxPbisPerFeature - featureBacklog.minPbisPerFeature + 1));
    for (let pbiIndex = 0; pbiIndex < pbiCount; pbiIndex += 1) {
      const pbi = createItem(0, "PBI", true, entryStage, { title: `${feature.title} · PBI ${pbiIndex + 1}`, featureId: feature.id, featureTitle: feature.title, ranking: feature.ranking });
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
    const { config: dayConfig, phase } = configForProjectDay(config, day);
    const featureFocus = completionFocusFor(day, dayConfig);
    dailyLog.push({
      day,
      seed,
      movements: emptyMovements(stages),
      featureFocus: featureFocus && { id: featureFocus.id, title: featureFocus.title },
      projectPhase: phase && { id: phase.id, label: phase.label },
    });
    feedbackArrivals = 0;
    const pushAllowance = poisson(dayConfig.arrivalRatePerDay, demandRandom) + (config.batchDays.includes(day) ? config.batchSize : 0);

    // Stable daily event order: completed work moves, policies are implicit in rates,
    // admissions/pulls happen, then available stages begin work. The all-three
    // policy concentrates *new* Features at Backlog; it never pauses work already
    // in flight. That lets a WIP-limited phase safely drain work inherited from an
    // earlier push phase instead of deadlocking above its newly introduced limits.
    [...stages.slice(1, -1)].reverse().forEach((stage) => {
      if (handoffs.has(stage)) pullHandoffWork(day, stage, dayConfig);
      else if (active.includes(stage)) moveBlocked(day, stage, dayConfig);
    });
    admitBacklogWork(day, pushAllowance, featureFocus, dayConfig);
    active.forEach((stage) => {
      const maximumConcurrency = dayConfig.operatingAssumptions?.[stage]?.maximumConcurrency ?? 16;
      activateWork(day, stage, maximumConcurrency, dayConfig);
    });
    const operatingCapacity = active.map((stage) => {
      const baseCapacity = processingRateFor(stage, day, dayConfig);
      const concurrentItems = concurrentItemCount(items, stage);
      const assumptions = dayConfig.operatingAssumptions?.[stage] ?? { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 };
      const { effectiveCapacity, taskSwitchingLoss } = effectiveCapacityFor(baseCapacity, concurrentItems, assumptions);
      return { stage, concurrentItems, baseCapacity, effectiveCapacity, taskSwitchingLoss };
    });
    const unusedCapacity = Object.fromEntries(
      operatingCapacity.map(({ stage, effectiveCapacity }) => [stage, processWork(day, stage, effectiveCapacity)]),
    );
    const capacityAssistance: CapacityAssistance[] = [];
    // WIP limits only govern admission, so their unused capacity stays idle.
    // Swarming is the separate policy that lends spare capacity to the most
    // constrained active stage. With ranking enabled, that help goes first to
    // the stage containing the highest-ranked active work.
    const swarmingActive = dayConfig.featureFocus !== undefined && day >= dayConfig.featureFocus.startDay;
    if (swarmingActive) {
      const effectiveness = dayConfig.wipAssistanceEffectiveness ?? 0.75;
      for (const sourceStage of active) {
        const offeredCapacity = unusedCapacity[sourceStage] * effectiveness;
        if (offeredCapacity <= 1e-9) continue;
        const target = swarmingTargetFor(sourceStage, dayConfig);
        if (!target) continue;
        const priorityRanking = dayConfig.backlogRanking ? target.priorityWork?.ranking : undefined;
        const unusedAssistance = processWork(
          day,
          target.stage,
          offeredCapacity,
          (item) => priorityRanking === undefined || item.ranking === priorityRanking,
        );
        const appliedCapacity = offeredCapacity - unusedAssistance;
        unusedCapacity[sourceStage] -= appliedCapacity;
        if (appliedCapacity > 0) {
          capacityAssistance.push({
            from: sourceStage,
            to: target.stage,
            capacity: appliedCapacity,
            effectiveness,
            reason: "swarming",
            featureId: target.priorityWork?.featureId,
          });
        }
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
      projectPhase: phase && { id: phase.id, label: phase.label },
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
