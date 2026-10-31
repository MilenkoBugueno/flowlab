import type { ActiveStage, CapacityIncident, ScenarioConfig, SwarmPolicy } from "./types";
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
    throw new Error("The arrival rate must be zero or greater.");
  }
  return { ...config, arrivalRatePerDay };
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
  baseRates?: Partial<Record<ActiveStage, number>>;
  incident?: CapacityIncident;
  swarm?: SwarmPolicy;
}

export function withSimulationSettings(config: ScenarioConfig, settings: SimulationSettings): ScenarioConfig {
  const withArrival = settings.arrivalRatePerDay === undefined
    ? config
    : withArrivalRate(config, settings.arrivalRatePerDay);
  const withRates = withProcessingRates(withArrival, settings.baseRates ?? {});
  const active = activeStages(withRates.workflow);
  const incident = settings.incident
    ? validateIncident(withRates, settings.incident)
    : withRates.incident;
  const swarm = settings.swarm ?? withRates.swarm;
  if (swarm && active.length >= 2) validateSwarm(withRates, swarm);
  return { ...withRates, incident, swarm: active.length >= 2 ? swarm : undefined };
}
