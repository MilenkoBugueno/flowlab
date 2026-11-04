import { withSimulationSettings } from "./settings";
import { scenarios } from "./scenarios";
import type { PhaseSettings, ProjectPhase, ScenarioConfig, ScenarioId } from "./types";
import { withWorkflow } from "./workflow";

export const PROJECT_FILE_VERSION = 1;

export interface ProjectFile {
  formatVersion: number;
  name: string;
  seed: number;
  config: ScenarioConfig;
  phases: ProjectPhase[];
}

/** Editable GUI representation of a project phase. */
export interface PhasePlanEntry {
  id: string;
  scenarioId: ScenarioId;
  durationDays: number;
  /** Retains custom imported phase values until the profile is explicitly changed. */
  settings?: PhaseSettings;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function phaseSettingsFor(config: ScenarioConfig): PhaseSettings {
  return {
    arrivalRatePerDay: config.arrivalRatePerDay,
    baseRates: clone(config.baseRates),
    serviceEffort: clone(config.serviceEffort),
    operatingAssumptions: clone(config.operatingAssumptions ?? {}),
    wipLimits: config.wipLimits && clone(config.wipLimits),
    backlogRanking: config.backlogRanking,
    wipAssistanceEffectiveness: config.wipAssistanceEffectiveness ?? 0.75,
    incident: config.incident && clone(config.incident),
    swarm: config.swarm && clone(config.swarm),
    featureFocus: config.featureFocus && clone(config.featureFocus),
  };
}

export function projectPhasesForPlan(header: ScenarioConfig, plan: PhasePlanEntry[]): ProjectPhase[] {
  if (!plan.length) throw new Error("A phase plan needs at least one phase.");
  let startDay = 0;
  return plan.map((entry) => {
    if (!Number.isInteger(entry.durationDays) || entry.durationDays <= 0) {
      throw new Error("A phase duration must be a positive whole number.");
    }
    const profile = scenarios[entry.scenarioId];
    const settings = entry.settings ?? phaseSettingsFor(configForPhaseProfile(header, entry.scenarioId));
    const phase: ProjectPhase = {
      id: entry.id,
      label: profile.label,
      startDay,
      endDay: startDay + entry.durationDays - 1,
      settings: clone(settings),
    };
    startDay = phase.endDay + 1;
    return phase;
  });
}

/**
 * Phase profiles are interventions, not a replacement for the global model.
 * This retains the workflow, rates, capacities, and initial settings edited in
 * the cockpit while applying the selected WIP/focus behaviour to the phase.
 */
function configForPhaseProfile(header: ScenarioConfig, scenarioId: ScenarioId): ScenarioConfig {
  const usesWipLimits = scenarioId === "wip" || scenarioId === "combined";
  const usesFinishingFocus = scenarioId === "swarm" || scenarioId === "combined";
  const usesBacklogRanking = scenarioId === "ranking";
  const defaultWipLimits = Object.fromEntries(
    header.workflow.stages.slice(1, -1).map((stage) => [stage, 5]),
  );
  return {
    ...header,
    wipLimits: usesWipLimits ? header.wipLimits ?? defaultWipLimits : undefined,
    featureFocus: usesFinishingFocus ? { startDay: 0 } : undefined,
    backlogRanking: usesBacklogRanking,
    incident: undefined,
    swarm: undefined,
  };
}

export function phasePlanFromProject(project: ProjectFile): PhasePlanEntry[] {
  return project.phases.map((phase) => {
    const profile = (Object.values(scenarios).find((scenario) => scenario.label === phase.label)?.id ?? "baseline") as ScenarioId;
    return {
      id: phase.id,
      scenarioId: profile,
      durationDays: phase.endDay - phase.startDay + 1,
      settings: clone(phase.settings),
    };
  });
}

export function configForProjectDay(config: ScenarioConfig, day: number): { config: ScenarioConfig; phase?: ProjectPhase } {
  const phase = config.projectPhases?.find((candidate) => day >= candidate.startDay && day <= candidate.endDay);
  if (!phase) return { config };
  return {
    phase,
    config: {
      ...config,
      ...clone(phase.settings),
      projectPhases: undefined,
    },
  };
}

export function createProjectFile(config: ScenarioConfig, seed: number, name = "FlowLab project"): ProjectFile {
  const { projectPhases: existingPhases, ...header } = clone(config);
  const phases = existingPhases?.length
    ? clone(existingPhases)
    : [{ id: "phase-1", label: config.label, startDay: 0, endDay: config.horizonDays - 1, settings: phaseSettingsFor(config) }];
  return { formatVersion: PROJECT_FILE_VERSION, name, seed, config: header, phases };
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function validatePhaseTimeline(phases: ProjectPhase[], horizonDays: number) {
  if (!phases.length) throw new Error("A project file needs at least one settings phase.");
  const ordered = [...phases].sort((a, b) => a.startDay - b.startDay);
  let expectedStartDay = 0;
  for (const phase of ordered) {
    if (!Number.isInteger(phase.startDay) || !Number.isInteger(phase.endDay) || phase.startDay < 0 || phase.endDay < phase.startDay || phase.endDay >= horizonDays) {
      throw new Error("Project phase days must be within the simulation horizon.");
    }
    if (phase.startDay !== expectedStartDay) {
      if (phase.startDay < expectedStartDay) throw new Error("Project phases cannot overlap.");
      throw new Error("Project phases must cover every simulation day exactly once.");
    }
    expectedStartDay = phase.endDay + 1;
  }
  if (expectedStartDay !== horizonDays) throw new Error("Project phases must cover every simulation day exactly once.");
}

function validatePhaseSettings(header: ScenarioConfig, phase: ProjectPhase): ProjectPhase {
  assertRecord(phase.settings, `Settings for phase ${phase.label}`);
  const settings = phase.settings as unknown as Record<string, unknown>;
  for (const initialOnly of ["workflow", "horizonDays", "warmupDays", "initialBacklog", "initialInventory", "featureBacklog", "seed"]) {
    if (initialOnly in settings) throw new Error("Initial backlog, workflow, horizon, and seed settings belong to the project header.");
  }
  const phaseConfig = { ...header, ...phase.settings, projectPhases: undefined };
  withSimulationSettings(phaseConfig, {
    arrivalRatePerDay: phase.settings.arrivalRatePerDay,
    baseRates: phase.settings.baseRates,
    operatingAssumptions: phase.settings.operatingAssumptions,
    wipAssistanceEffectiveness: phase.settings.wipAssistanceEffectiveness,
    backlogRanking: phase.settings.backlogRanking,
    featureFocus: phase.settings.featureFocus ?? null,
    incident: phase.settings.incident,
    swarm: phase.settings.swarm,
  });
  for (const [stage, limits] of Object.entries(phase.settings.wipLimits ?? {})) {
    if (!header.workflow.stages.includes(stage) || !Number.isInteger(limits) || (limits ?? -1) < 0) {
      throw new Error("Project phase WIP limits must be non-negative whole numbers for workflow stages.");
    }
  }
  return clone(phase);
}

export function parseProjectFile(contents: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  assertRecord(raw, "Project file");
  if (raw.formatVersion !== PROJECT_FILE_VERSION) throw new Error("The project-file version is not supported.");
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error("A project file needs a name.");
  if (!Number.isInteger(raw.seed) || (raw.seed as number) < 0) throw new Error("A project file seed must be a non-negative whole number.");
  assertRecord(raw.config, "Project configuration");
  const headerInput = raw.config as unknown as ScenarioConfig;
  const header = withWorkflow({ ...headerInput, projectPhases: undefined }, headerInput.workflow?.stages ?? []);
  if (!Number.isInteger(header.horizonDays) || header.horizonDays < 1) throw new Error("The project horizon must be a positive whole number.");
  if (!Array.isArray(raw.phases)) throw new Error("Project phases must be an array.");
  const phases = raw.phases as ProjectPhase[];
  validatePhaseTimeline(phases, header.horizonDays);
  const validatedPhases = phases.map((phase) => validatePhaseSettings(header, phase));
  return { formatVersion: PROJECT_FILE_VERSION, name: raw.name, seed: raw.seed as number, config: clone(header), phases: validatedPhases };
}

export function configFromProjectFile(project: ProjectFile): ScenarioConfig {
  return { ...clone(project.config), projectPhases: clone(project.phases) };
}
