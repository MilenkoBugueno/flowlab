export type Stage = string;
export type ActiveStage = string;
export type ItemStatus = "waiting" | "active" | "blocked" | "done";
export type ScenarioId = "baseline" | "swarm" | "wip" | "combined";

export interface WorkflowConfig {
  stages: Stage[];
}

export interface CapacityIncident {
  stage: ActiveStage;
  startDay: number;
  endDay: number;
  ratePerDay: number;
}

export interface SwarmPolicy {
  startDay: number;
  durationDays: number;
  sourceStage: ActiveStage;
  targetStage: ActiveStage;
  capacityShift: number;
  rampUpEffectiveness: number;
}

export interface OperatingAssumptions {
  focusWip: number;
  maximumConcurrency: number;
  taskSwitchingLossRatio: number;
}

export interface ScenarioConfig {
  id: ScenarioId;
  label: string;
  summary: string;
  workflow: WorkflowConfig;
  horizonDays: number;
  warmupDays: number;
  arrivalRatePerDay: number;
  batchDays: number[];
  batchSize: number;
  baseRates: Partial<Record<ActiveStage, number>>;
  serviceEffort: Partial<Record<ActiveStage, { min: number; max: number }>>;
  operatingAssumptions?: Partial<Record<ActiveStage, OperatingAssumptions>>;
  wipLimits?: Partial<Record<ActiveStage, number>>;
  wipAssistanceEffectiveness?: number;
  incident?: CapacityIncident;
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
  capacityAssistance?: CapacityAssistance[];
  operatingCapacity?: DailyOperatingCapacity[];
}

export interface CapacityAssistance {
  from: ActiveStage;
  to: ActiveStage;
  capacity: number;
  effectiveness: number;
}

export interface DailyOperatingCapacity {
  stage: ActiveStage;
  concurrentItems: number;
  baseCapacity: number;
  effectiveCapacity: number;
  taskSwitchingLoss: number;
}

export interface DailyMovement {
  from: Stage | "External";
  to: Stage;
  count: number;
}

export interface DailyLogEntry {
  day: number;
  seed: number;
  movements: DailyMovement[];
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
  totalTaskSwitchingLoss: number;
  littlesLawEstimate: number | null;
}

export interface SimulationResult {
  config: ScenarioConfig;
  seed: number;
  items: WorkItem[];
  events: FlowEvent[];
  snapshots: DailySnapshot[];
  dailyLog: DailyLogEntry[];
  metrics: Metrics;
}

export interface MeanSimulationResult {
  config: ScenarioConfig;
  seeds: number[];
  runs: SimulationResult[];
  snapshots: DailySnapshot[];
  metrics: Metrics;
}

export type SimulationViewResult = SimulationResult | MeanSimulationResult;
