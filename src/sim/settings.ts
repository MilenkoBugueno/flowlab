import type { ActiveStage, CapacityIncident, FeatureBacklogConfig, FeatureFocusPolicy, InitialBacklog, InitialInventory, OperatingAssumptions, ScenarioConfig, SwarmPolicy } from "./types";
import { activeStages } from "./workflow";

function assertPositiveRate(rate: number, label: string) {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`${label} must be greater than zero.`);
}

function assertActiveStage(stage: string, active: ActiveStage[], label: string) {
  if (!active.includes(stage)) throw new Error(`${label} must be an active workflow stage.`);
}

export function withProcessingRates(config: ScenarioConfig, updates: Partial<Record<ActiveStage, number>>): ScenarioConfig {
  const active = activeStages(config.workflow);
  const baseRates = Object.fromEntries(active.map((stage) => {
    const rate = updates[stage] ?? config.baseRates[stage] ?? 1;
    assertPositiveRate(rate, `The daily processing rate for ${stage}`);
    return [stage, rate];
  }));
  return { ...config, baseRates };
}

export function withArrivalRate(config: ScenarioConfig, arrivalRatePerDay: number): ScenarioConfig {
  if (!Number.isFinite(arrivalRatePerDay) || arrivalRatePerDay < 0) {
    throw new Error("The backlog push rate must be zero or greater.");
  }
  return { ...config, arrivalRatePerDay };
}

export function validateInitialBacklog(backlog: InitialBacklog): InitialBacklog {
  for (const [label, count] of [["PBI", backlog.pbiCount], ["bug", backlog.bugCount]] as const) {
    if (!Number.isInteger(count) || count < 0) throw new Error(`The initial ${label} count must be a non-negative whole number.`);
  }
  return backlog;
}

export function validateInitialInventory(config: ScenarioConfig, inventory: InitialInventory): InitialInventory {
  const stages = config.workflow.stages;
  const seedableStages = stages.slice(0, -1);
  const terminalStage = stages.at(-1);
  if (terminalStage && inventory[terminalStage] && (inventory[terminalStage]?.pbiCount || inventory[terminalStage]?.bugCount)) {
    throw new Error(`The final workflow stage, ${terminalStage}, cannot contain initial inventory.`);
  }
  for (const stage of Object.keys(inventory)) {
    if (!seedableStages.includes(stage)) throw new Error(`${stage} is not a seedable workflow stage.`);
  }
  return Object.fromEntries(seedableStages.map((stage) => {
    const counts = inventory[stage] ?? { pbiCount: 0, bugCount: 0 };
    for (const [type, count] of [["PBI", counts.pbiCount], ["bug", counts.bugCount]] as const) {
      if (!Number.isInteger(count) || count < 0) throw new Error(`The initial ${stage} ${type} count must be a non-negative whole number.`);
    }
    return [stage, counts];
  }));
}

export function validateFeatureBacklog(config: FeatureBacklogConfig): FeatureBacklogConfig {
  if (!Number.isInteger(config.featureCount) || config.featureCount < 0) {
    throw new Error("The initial feature count must be a non-negative whole number.");
  }
  if (!Number.isInteger(config.minPbisPerFeature) || config.minPbisPerFeature < 1) {
    throw new Error("The minimum PBIs per feature must be a positive whole number.");
  }
  if (!Number.isInteger(config.maxPbisPerFeature) || config.maxPbisPerFeature < config.minPbisPerFeature) {
    throw new Error("The maximum PBIs per feature must be at least the minimum.");
  }
  if (!Number.isFinite(config.baseBugEffort) || config.baseBugEffort <= 0) {
    throw new Error("The base Bug effort must be greater than zero.");
  }
  if (!Number.isFinite(config.feedbackDelayEffortFactor) || config.feedbackDelayEffortFactor < 0) {
    throw new Error("The feedback-delay effort factor must be zero or greater.");
  }
  return config;
}

export function validateFeatureFocus(config: ScenarioConfig, policy: FeatureFocusPolicy): FeatureFocusPolicy {
  if (!Number.isInteger(policy.startDay) || policy.startDay < 0 || policy.startDay >= config.horizonDays) {
    throw new Error("The completion-focus start day must be within the simulation horizon.");
  }
  return policy;
}

export function validateWipAssistanceEffectiveness(effectiveness: number): number {
  if (!Number.isFinite(effectiveness) || effectiveness < 0 || effectiveness > 1) {
    throw new Error("WIP assistance effectiveness must be between zero and one.");
  }
  return effectiveness;
}

export function validateBacklogRanking(enabled: boolean): boolean {
  if (typeof enabled !== "boolean") throw new Error("Backlog ranking must be enabled or disabled.");
  return enabled;
}

export function validateOperatingAssumptions(assumptions: OperatingAssumptions): OperatingAssumptions {
  if (!Number.isInteger(assumptions.focusWip) || assumptions.focusWip < 1) {
    throw new Error("Focus WIP must be a positive whole number.");
  }
  if (!Number.isInteger(assumptions.maximumConcurrency) || assumptions.maximumConcurrency < assumptions.focusWip) {
    throw new Error("Maximum concurrency must be at least focus WIP.");
  }
  if (!Number.isFinite(assumptions.taskSwitchingLossRatio) || assumptions.taskSwitchingLossRatio < 0 || assumptions.taskSwitchingLossRatio > 1) {
    throw new Error("The task-switching loss ratio must be between zero and one.");
  }
  return assumptions;
}

export function withOperatingAssumptions(config: ScenarioConfig, updates: Partial<Record<ActiveStage, OperatingAssumptions>>): ScenarioConfig {
  const operatingAssumptions = Object.fromEntries(activeStages(config.workflow).map((stage) => {
    const assumptions = updates[stage] ?? config.operatingAssumptions?.[stage] ?? { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 };
    return [stage, validateOperatingAssumptions(assumptions)];
  }));
  return { ...config, operatingAssumptions };
}

export function validateIncident(config: ScenarioConfig, incident: CapacityIncident): CapacityIncident {
  const active = activeStages(config.workflow);
  assertActiveStage(incident.stage, active, "The incident stage");
  assertPositiveRate(incident.ratePerDay, "The incident daily processing rate");
  if (!Number.isInteger(incident.startDay) || !Number.isInteger(incident.endDay) || incident.startDay < 0 || incident.endDay < incident.startDay || incident.endDay >= config.horizonDays) {
    throw new Error("Incident days must be within the simulation horizon and end on or after the start day.");
  }
  return incident;
}

export function validateSwarm(config: ScenarioConfig, swarm: SwarmPolicy): SwarmPolicy {
  const active = activeStages(config.workflow);
  assertActiveStage(swarm.sourceStage, active, "The swarm source stage");
  assertActiveStage(swarm.targetStage, active, "The swarm target stage");
  if (swarm.sourceStage === swarm.targetStage) throw new Error("A swarm needs different source and target stages.");
  if (!Number.isInteger(swarm.startDay) || swarm.startDay < 0 || !Number.isInteger(swarm.durationDays) || swarm.durationDays <= 0 || swarm.startDay + swarm.durationDays > config.horizonDays) {
    throw new Error("Swarm timing must fit within the simulation horizon.");
  }
  assertPositiveRate(swarm.capacityShift, "The swarm capacity shift");
  if (swarm.capacityShift > (config.baseRates[swarm.sourceStage] ?? 1)) {
    throw new Error("The swarm capacity shift cannot exceed the source stage's daily processing rate.");
  }
  if (!Number.isFinite(swarm.rampUpEffectiveness) || swarm.rampUpEffectiveness < 0 || swarm.rampUpEffectiveness > 1) {
    throw new Error("First-day swarm effectiveness must be between zero and one.");
  }
  return swarm;
}

export interface SimulationSettings {
  arrivalRatePerDay?: number;
  initialBacklog?: InitialBacklog;
  initialInventory?: InitialInventory;
  featureBacklog?: FeatureBacklogConfig;
  featureFocus?: FeatureFocusPolicy | null;
  backlogRanking?: boolean;
  wipAssistanceEffectiveness?: number;
  operatingAssumptions?: Partial<Record<ActiveStage, OperatingAssumptions>>;
  baseRates?: Partial<Record<ActiveStage, number>>;
  incident?: CapacityIncident;
  swarm?: SwarmPolicy;
}

export function withSimulationSettings(config: ScenarioConfig, settings: SimulationSettings): ScenarioConfig {
  const withArrival = settings.arrivalRatePerDay === undefined
    ? config
    : withArrivalRate(config, settings.arrivalRatePerDay);
  const initialBacklog = settings.initialBacklog === undefined
    ? (withArrival.initialBacklog ?? { pbiCount: 0, bugCount: 0 })
    : validateInitialBacklog(settings.initialBacklog);
  const initialInventory = settings.initialInventory === undefined
    ? withArrival.initialInventory
    : validateInitialInventory(withArrival, settings.initialInventory);
  const featureBacklog = settings.featureBacklog === undefined
    ? (withArrival.featureBacklog ?? { featureCount: 0, minPbisPerFeature: 5, maxPbisPerFeature: 10, baseBugEffort: 1, feedbackDelayEffortFactor: 0.1 })
    : validateFeatureBacklog(settings.featureBacklog);
  const featureFocus = settings.featureFocus === undefined
    ? withArrival.featureFocus
    : settings.featureFocus === null
      ? undefined
      : validateFeatureFocus(withArrival, settings.featureFocus);
  const backlogRanking = settings.backlogRanking === undefined
    ? withArrival.backlogRanking
    : validateBacklogRanking(settings.backlogRanking);
  const withRates = withProcessingRates(withArrival, settings.baseRates ?? {});
  const wipAssistanceEffectiveness = settings.wipAssistanceEffectiveness === undefined
    ? (withRates.wipAssistanceEffectiveness ?? 0.75)
    : validateWipAssistanceEffectiveness(settings.wipAssistanceEffectiveness);
  const withOperating = withOperatingAssumptions(withRates, settings.operatingAssumptions ?? {});
  const active = activeStages(withOperating.workflow);
  const incident = settings.incident
    ? validateIncident(withOperating, settings.incident)
    : withOperating.incident;
  const swarm = settings.swarm ?? withOperating.swarm;
  if (swarm && active.length >= 2) validateSwarm(withOperating, swarm);
  return { ...withOperating, initialBacklog, initialInventory, featureBacklog, featureFocus, backlogRanking, wipAssistanceEffectiveness, incident, swarm: active.length >= 2 ? swarm : undefined };
}
