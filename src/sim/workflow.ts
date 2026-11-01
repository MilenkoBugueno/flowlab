import type { ActiveStage, ScenarioConfig, Stage, WorkflowConfig } from "./types";

const defaultEffort = { min: 0.75, max: 1.25 };

export const defaultWorkflow: WorkflowConfig = {
  stages: ["Backlog", "Development", "Test", "Done"],
};

export function activeStages(workflow: WorkflowConfig): ActiveStage[] {
  return workflow.stages.slice(1, -1);
}

export function validateWorkflow(stages: string[]): Stage[] {
  const cleaned = stages.map((stage) => stage.trim()).filter(Boolean);
  if (cleaned.length < 2) throw new Error("A workflow needs an entry and an exit state.");
  if (cleaned.length !== stages.length) throw new Error("Every workflow state needs a name.");
  if (new Set(cleaned.map((stage) => stage.toLocaleLowerCase())).size !== cleaned.length) {
    throw new Error("Workflow state names must be unique.");
  }
  return cleaned;
}

function stageAtSamePosition(source: Stage[], target: Stage, targetIndex: number): Stage | undefined {
  return source.includes(target) ? target : source[targetIndex];
}

export function withWorkflow(config: ScenarioConfig, states: string[]): ScenarioConfig {
  const stages = validateWorkflow(states);
  const oldActive = activeStages(config.workflow);
  const nextActive = stages.slice(1, -1);
  const valueFor = <T>(values: Partial<Record<ActiveStage, T>>, stage: Stage, index: number, fallback: T): T => {
    const oldStage = stageAtSamePosition(oldActive, stage, index);
    return oldStage === undefined ? fallback : (values[oldStage] ?? fallback);
  };
  const baseRates = Object.fromEntries(nextActive.map((stage, index) => [stage, valueFor(config.baseRates, stage, index, 1)]));
  const serviceEffort = Object.fromEntries(nextActive.map((stage, index) => [stage, valueFor(config.serviceEffort, stage, index, defaultEffort)]));
  const mapExistingStage = (stage: Stage): Stage | undefined => {
    if (nextActive.includes(stage)) return stage;
    const oldIndex = oldActive.indexOf(stage);
    return oldIndex >= 0 ? nextActive[Math.min(oldIndex, nextActive.length - 1)] : undefined;
  };
  const incidentStage = config.incident && (mapExistingStage(config.incident.stage) ?? stages[0]);
  const mappedSource = config.swarm && mapExistingStage(config.swarm.sourceStage);
  const mappedTarget = config.swarm && mapExistingStage(config.swarm.targetStage);
  const wipLimits = config.wipLimits
    ? Object.fromEntries(nextActive.flatMap((stage, index) => {
      const oldStage = stageAtSamePosition(oldActive, stage, index);
      const limit = oldStage === undefined ? 5 : (config.wipLimits?.[oldStage] ?? 5);
      return [[stage, limit]];
    }))
    : undefined;

  return {
    ...config,
    workflow: { stages },
    baseRates,
    serviceEffort,
    wipLimits,
    incident: config.incident && incidentStage ? { ...config.incident, stage: incidentStage } : undefined,
    swarm: config.swarm && mappedSource && mappedTarget && mappedSource !== mappedTarget
      ? { ...config.swarm, sourceStage: mappedSource, targetStage: mappedTarget }
      : undefined,
  };
}
