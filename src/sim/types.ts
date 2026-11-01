export type Stage = string;
export type ActiveStage = string;
export type ItemStatus = "waiting" | "active" | "blocked" | "done";
export type WorkItemType = "PBI" | "Bug";
export type ScenarioId = "baseline" | "swarm" | "wip" | "combined";

export interface WorkflowConfig {
  stages: Stage[];
  /** Passive handoff buffers: visible in the flow, but do not receive processing capacity. */
  handoffStages?: Stage[];
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

export interface InitialBacklog {
  pbiCount: number;
  bugCount: number;
}

export type InitialInventory = Partial<Record<Stage, InitialBacklog>>;

export interface FeatureBacklogConfig {
  featureCount: number;
  minPbisPerFeature: number;
  maxPbisPerFeature: number;
  baseBugEffort: number;
  feedbackDelayEffortFactor: number;
}

export interface FeatureFocusPolicy {
  /** First simulated day on which the completion focus is applied. */
  startDay: number;
}

export interface Feature {
  id: string;
  title: string;
  pbiIds: string[];
  bugIds: string[];
  completedAt?: number;
}

export interface ScenarioConfig {
  id: ScenarioId;
  label: string;
  summary: string;
  workflow: WorkflowConfig;
  horizonDays: number;
  warmupDays: number;
  arrivalRatePerDay: number;
  initialBacklog?: InitialBacklog;
  initialInventory?: InitialInventory;
  featureBacklog?: FeatureBacklogConfig;
  featureFocus?: FeatureFocusPolicy;
  batchDays: number[];
  batchSize: number;
  baseRates: Partial<Record<ActiveStage, number>>;
  serviceEffort: Partial<Record<ActiveStage, { min: number; max: number }>>;
  operatingAssumptions?: Partial<Record<ActiveStage, OperatingAssumptions>>;
  wipLimits?: Partial<Record<Stage, number>>;
  wipAssistanceEffectiveness?: number;
  incident?: CapacityIncident;
  swarm?: SwarmPolicy;
}

export interface WorkItem {
  id: string;
  title: string;
  type: WorkItemType;
  initial: boolean;
  arrivedAt: number;
  stage: Stage;
  status: ItemStatus;
  active: boolean;
  progressPercent: number;
  totalEffort: number;
  completedEffort: number;
  plannedEffort: Partial<Record<ActiveStage, number>>;
  effortRemaining: number;
  enteredAt: Partial<Record<Stage, number>>;
  startedAt: Partial<Record<ActiveStage, number>>;
  firstStartedAt?: number;
  completedAt?: number;
  featureId?: string;
  featureTitle?: string;
  originatingPbiId?: string;
  developedAt?: number;
  testedAt?: number;
  feedbackDelayDays?: number;
  feedbackBugId?: string;
  history: ItemTimelineState[];
}

export interface ItemTimelineState {
  day: number;
  stage: Stage;
  active: boolean;
  progressPercent: number;
  startDate?: number;
  completionDate?: number;
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
  featureFocus?: FeatureFocusState;
}

export interface CapacityAssistance {
  from: ActiveStage;
  to: ActiveStage;
  capacity: number;
  effectiveness: number;
  reason?: "wip-assistance" | "completion-focus";
  featureId?: string;
}

export interface FeatureFocusState {
  id: string;
  title: string;
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
  featureFocus?: FeatureFocusState;
}

export interface Metrics {
  completedItems: number;
  completedFeatures: number;
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
  features: Feature[];
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
