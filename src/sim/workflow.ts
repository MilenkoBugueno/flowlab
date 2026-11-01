import type { ActiveStage, InitialInventory, ScenarioConfig, Stage, WorkflowConfig } from "./types";

const defaultEffort = { min: 0.75, max: 1.25 };

export const defaultWorkflow: WorkflowConfig = {
  stages: ["Backlog", "Development", "Integration", "Test", "Done"],
  handoffStages: ["Integration"],
};

export function activeStages(workflow: WorkflowConfig): ActiveStage[] {
  const handoffs = new Set(workflow.handoffStages ?? []);
  return workflow.stages.slice(1, -1).filter((stage) => !handoffs.has(stage));
}

export function handoffStages(workflow: WorkflowConfig): Stage[] {
  const entryStage = workflow.stages[0];
  const exitStage = workflow.stages.at(-1);
  return (workflow.handoffStages ?? []).filter((stage) => (
    workflow.stages.includes(stage) && stage !== entryStage && stage !== exitStage
  ));
}

export function nextActiveStage(stage: Stage, workflow: WorkflowConfig): ActiveStage | undefined {
  const stageIndex = workflow.stages.indexOf(stage);
  return activeStages(workflow).find((candidate) => workflow.stages.indexOf(candidate) > stageIndex);
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
  const nextHandoffs = handoffStages(config.workflow).filter((stage) => stages.includes(stage));
  const nextWorkflow: WorkflowConfig = { stages, handoffStages: nextHandoffs.length ? nextHandoffs : undefined };
  const nextActive = activeStages(nextWorkflow);
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
  const oldWipStages = config.workflow.stages.slice(1, -1);
  const nextWipStages = stages.slice(1, -1);
  const wipLimits = config.wipLimits
    ? Object.fromEntries(nextWipStages.map((stage, index) => {
      const oldStage = stageAtSamePosition(oldWipStages, stage, index);
      const limit = oldStage === undefined ? 5 : (config.wipLimits?.[oldStage] ?? 5);
      return [stage, limit];
    }))
    : undefined;
  const initialInventory: InitialInventory | undefined = config.initialInventory
    ? Object.fromEntries(stages.slice(0, -1).map((stage, index) => {
      const oldStage = config.workflow.stages.includes(stage) ? stage : config.workflow.stages[index];
      return [stage, oldStage ? (config.initialInventory?.[oldStage] ?? { pbiCount: 0, bugCount: 0 }) : { pbiCount: 0, bugCount: 0 }];
    }))
    : undefined;

  return {
    ...config,
    workflow: nextWorkflow,
    baseRates,
    serviceEffort,
    wipLimits,
    initialInventory,
    incident: config.incident && incidentStage ? { ...config.incident, stage: incidentStage } : undefined,
    swarm: config.swarm && mappedSource && mappedTarget && mappedSource !== mappedTarget
      ? { ...config.swarm, sourceStage: mappedSource, targetStage: mappedTarget }
      : undefined,
  };
}
