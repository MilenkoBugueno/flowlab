export const stages = ["ready", "development", "review", "test", "done"] as const;
export type Stage = (typeof stages)[number];
export type ActiveStage = Exclude<Stage, "ready" | "done">;
export type ItemStatus = "waiting" | "active" | "blocked" | "done";
export type ScenarioId = "baseline" | "swarm" | "wip" | "combined";

export interface CapacityIncident {
  stage: ActiveStage;
  startDay: number;
  endDay: number;
  ratePerDay: number;
}

export interface SwarmPolicy {
  startDay: number;
  durationDays: number;
  sourceStage: "development";
  targetStage: "review";
  capacityShift: number;
  rampUpEffectiveness: number;
}

export interface ScenarioConfig {
  id: ScenarioId;
  label: string;
  summary: string;
  horizonDays: number;
  warmupDays: number;
  arrivalRatePerDay: number;
  batchDays: number[];
  batchSize: number;
  baseRates: Record<ActiveStage, number>;
  serviceEffort: Record<ActiveStage, { min: number; max: number }>;
  wipLimits?: Partial<Record<ActiveStage, number>>;
  incident: CapacityIncident;
  swarm?: SwarmPolicy;
}

export interface WorkItem {
  id: string;
  arrivedAt: number;
  stage: Stage;
  status: ItemStatus;
  effortRemaining: number;
  enteredAt: Partial<Record<Stage, number>>;
  startedAt: Partial<Record<ActiveStage, number>>;
  completedAt?: number;
}

export interface FlowEvent {
  day: number;
  type: "arrival" | "entered-stage" | "started" | "completed" | "blocked";
  itemId: string;
  stage: Stage;
}

export interface DailySnapshot {
  day: number;
  states: Record<Stage, number>;
  active: Record<ActiveStage, number>;
  waiting: Record<Stage, number>;
  arrivals: number;
  completions: number;
  externalBacklog: number;
}

export interface Metrics {
  completedItems: number;
  throughputPerWeek: number;
  medianCycleTime: number | null;
  p85CycleTime: number | null;
  maxReviewWip: number;
  reviewQueueDays: number;
  totalQueueDays: number;
  meanWip: number;
  littlesLawEstimate: number | null;
}

export interface SimulationResult {
  config: ScenarioConfig;
  seed: number;
  items: WorkItem[];
  events: FlowEvent[];
  snapshots: DailySnapshot[];
  metrics: Metrics;
}
