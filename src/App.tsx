import { useEffect, useMemo, useRef, useState } from "react";
import { CfdChart } from "./chart/CfdChart";
import { DailyLog } from "./DailyLog";
import { KanbanBoard } from "./KanbanBoard";
import { runScenario } from "./sim/engine";
import { runMeanScenario, validateMeanSeedCount } from "./sim/mean";
import { baselineConfigForComparison, configFromProjectFile, createProjectFile, noPhaseInterventions, parseProjectFile, phaseInterventionsForEntry, phasePlanFromProject, phaseSettingsFor, projectPhasesForPlan } from "./sim/project";
import type { PhaseInterventions, PhasePlanEntry } from "./sim/project";
import { scenarios } from "./sim/scenarios";
import { withSimulationSettings } from "./sim/settings";
import type { CapacityIncident, FeatureBacklogConfig, FeatureFocusPolicy, InitialInventory, Metrics, OperatingAssumptions, ScenarioConfig, SwarmPolicy } from "./sim/types";
import { activeStages, withWorkflow } from "./sim/workflow";

const metricLabels: Array<[keyof Metrics, string, string]> = [
  ["completedItems", "Completed items", "More is better, if cycle time remains healthy."],
  ["completedFeatures", "Completed features", "All features whose PBIs and generated feedback Bugs are Done in this simulation."],
  ["p85CycleTime", "p85 cycle time", "Days from first active work to completion for 85% of completed work."],
  ["maxReviewWip", "Peak constraint WIP", "The highest number of items in the constrained workflow stage."],
  ["reviewQueueDays", "Constraint queue-days", "Total waiting pressure in the constrained workflow stage."],
  ["totalTaskSwitchingLoss", "Task-switch loss", "Daily capacity lost to work beyond focus WIP."],
];

const defaultFeatureBacklog: FeatureBacklogConfig = {
  featureCount: 10,
  minPbisPerFeature: 3,
  maxPbisPerFeature: 7,
  baseBugEffort: 1,
  feedbackDelayEffortFactor: 0.2,
};

const defaultOperatingAssumptions: Partial<Record<string, OperatingAssumptions>> = {
  Development: { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.4 },
  Test: { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.4 },
};

function formatMetric(key: keyof Metrics, value: Metrics[keyof Metrics]) {
  if (value === null) return "—";
  if (key === "p85CycleTime" || key === "medianCycleTime" || key === "meanWip" || key === "totalTaskSwitchingLoss" || key === "littlesLawEstimate") return Number(value).toFixed(1);
  return Number(value).toFixed(0);
}

function inventoryForStages(inventory: InitialInventory, stages: string[]): InitialInventory {
  return Object.fromEntries(stages.slice(0, -1).map((stage) => [stage, inventory[stage] ?? { pbiCount: 0, bugCount: 0 }]));
}

export default function App() {
  const [seedInput, setSeedInput] = useState("42");
  const [arrivalRateInput, setArrivalRateInput] = useState("4.2");
  const [savedArrivalRate, setSavedArrivalRate] = useState(4.2);
  const [wipAssistanceInput, setWipAssistanceInput] = useState(String(scenarios.baseline.wipAssistanceEffectiveness ?? 0.75));
  const [savedWipAssistanceEffectiveness, setSavedWipAssistanceEffectiveness] = useState(scenarios.baseline.wipAssistanceEffectiveness ?? 0.75);
  const [arrivalRateError, setArrivalRateError] = useState<string>();
  const [savedInitialInventory, setSavedInitialInventory] = useState<InitialInventory>({});
  const [savedFeatureBacklog, setSavedFeatureBacklog] = useState<FeatureBacklogConfig>(defaultFeatureBacklog);
  const [featureBacklogDraft, setFeatureBacklogDraft] = useState<FeatureBacklogConfig>(defaultFeatureBacklog);
  const [featureBacklogError, setFeatureBacklogError] = useState<string>();
  const [savedFeatureFocus, setSavedFeatureFocus] = useState<FeatureFocusPolicy | null>();
  const [featureFocusEnabled, setFeatureFocusEnabled] = useState(false);
  const [featureFocusStartDay, setFeatureFocusStartDay] = useState("0");
  const [featureFocusError, setFeatureFocusError] = useState<string>();
  const [meanSeedCountInput, setMeanSeedCountInput] = useState("1");
  const [meanSeedCount, setMeanSeedCount] = useState(1);
  const [meanSeedError, setMeanSeedError] = useState<string>();
  const [runKey, setRunKey] = useState(0);
  const [workflowInput, setWorkflowInput] = useState(scenarios.baseline.workflow.stages.join(", "));
  const [workflow, setWorkflow] = useState(scenarios.baseline.workflow.stages);
  const [workflowError, setWorkflowError] = useState<string>();
  const [savedRates, setSavedRates] = useState<Record<string, number>>({ Development: 4, Test: 2 });
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [savedOperatingAssumptions, setSavedOperatingAssumptions] = useState<Partial<Record<string, OperatingAssumptions>>>(defaultOperatingAssumptions);
  const [operatingDraft, setOperatingDraft] = useState<Partial<Record<string, OperatingAssumptions>>>({});
  const [savedWipLimits, setSavedWipLimits] = useState<Partial<Record<string, number>> | undefined>({ Development: 5, Integration: 5, Test: 5 });
  const [wipLimitDraft, setWipLimitDraft] = useState<Record<string, string>>({});
  const [capacityError, setCapacityError] = useState<string>();
  const [capacityModalOpen, setCapacityModalOpen] = useState(false);
  const [savedIncident, setSavedIncident] = useState<CapacityIncident>();
  const [savedSwarm, setSavedSwarm] = useState<SwarmPolicy>();
  const [incidentDraft, setIncidentDraft] = useState<CapacityIncident>();
  const [swarmDraft, setSwarmDraft] = useState<SwarmPolicy>();
  const [interventionError, setInterventionError] = useState<string>();
  const [projectName, setProjectName] = useState("FlowLab project");
  const [phasePlan, setPhasePlan] = useState<PhasePlanEntry[]>([
    { id: "phase-1", interventions: noPhaseInterventions(), durationDays: 20 },
    { id: "phase-2", interventions: noPhaseInterventions(), durationDays: 20 },
    { id: "phase-3", interventions: noPhaseInterventions(), durationDays: 20 },
    { id: "phase-4", interventions: noPhaseInterventions(), durationDays: 20 },
  ]);
  const [phasePlanError, setPhasePlanError] = useState<string>();
  const [projectHeaderOverrides, setProjectHeaderOverrides] = useState<Partial<ScenarioConfig>>({});
  const [projectFileError, setProjectFileError] = useState<string>();
  const projectFileInput = useRef<HTMLInputElement>(null);
  const seed = Number.isFinite(Number(seedInput)) ? Math.max(0, Math.floor(Number(seedInput))) : 42;
  const projectBaseConfig = useMemo(
    () => ({ ...scenarios.baseline, ...projectHeaderOverrides, projectPhases: undefined }),
    [projectHeaderOverrides],
  );
  const workflowConfig = useMemo(() => withWorkflow(projectBaseConfig, workflow), [projectBaseConfig, workflow]);
  const customizedConfig = useMemo(
    () => withSimulationSettings(workflowConfig, { arrivalRatePerDay: savedArrivalRate, initialInventory: inventoryForStages(savedInitialInventory, workflowConfig.workflow.stages), featureBacklog: savedFeatureBacklog, featureFocus: savedFeatureFocus, wipAssistanceEffectiveness: savedWipAssistanceEffectiveness, baseRates: savedRates, operatingAssumptions: savedOperatingAssumptions, wipLimits: savedWipLimits, incident: savedIncident, swarm: savedSwarm }),
    [workflowConfig, savedArrivalRate, savedInitialInventory, savedFeatureBacklog, savedFeatureFocus, savedWipAssistanceEffectiveness, savedRates, savedOperatingAssumptions, savedWipLimits, savedIncident, savedSwarm],
  );
  const phasePlanHorizon = phasePlan.reduce((total, phase) => total + phase.durationDays, 0);
  const projectPhases = useMemo(
    () => projectPhasesForPlan({ ...customizedConfig, horizonDays: phasePlanHorizon }, phasePlan),
    [customizedConfig, phasePlan, phasePlanHorizon],
  );
  const selectedConfig = useMemo(
    () => ({ ...customizedConfig, horizonDays: phasePlanHorizon, projectPhases }),
    [customizedConfig, phasePlanHorizon, projectPhases],
  );
  const baselineConfig = useMemo(
    () => baselineConfigForComparison(selectedConfig),
    [selectedConfig],
  );
  const baseline = useMemo(
    () => meanSeedCount === 1 ? runScenario(baselineConfig, seed) : runMeanScenario(baselineConfig, meanSeedCount, seed),
    [baselineConfig, seed, meanSeedCount, runKey],
  );
  const selected = useMemo(
    () => meanSeedCount === 1 ? runScenario(selectedConfig, seed) : runMeanScenario(selectedConfig, meanSeedCount, seed),
    [selectedConfig, seed, meanSeedCount, runKey],
  );
  const [selectedDay, setSelectedDay] = useState(50);
  const visibleSelectedDay = Math.min(selectedDay, selectedConfig.horizonDays - 1);
  const [visualization, setVisualization] = useState<"cfd" | "kanban">("cfd");
  const [showInactiveWork, setShowInactiveWork] = useState(false);
  const [showFeatureCompletions, setShowFeatureCompletions] = useState(false);
  const [showFeatureHandoffs, setShowFeatureHandoffs] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    if (!focusMode) return;
    const exitFocusMode = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusMode(false);
    };
    document.addEventListener("keydown", exitFocusMode);
    return () => document.removeEventListener("keydown", exitFocusMode);
  }, [focusMode]);
  const isBaselinePlan = phasePlan.every((phase) => {
    const interventions = phaseInterventionsForEntry(phase);
    return !interventions.wipLimits && !interventions.featureFocus && !interventions.backlogRanking;
  });
  const activeWorkflowStages = activeStages(workflowConfig.workflow);
  const wipLimitStages = workflowConfig.workflow.stages.slice(1, -1);
  const fallbackIncident: CapacityIncident = {
    stage: activeWorkflowStages[0] ?? "",
    startDay: 30,
    endDay: 44,
    ratePerDay: 0.4,
  };
  const incidentForm = incidentDraft ?? savedIncident ?? workflowConfig.incident ?? fallbackIncident;
  const fallbackSwarm: SwarmPolicy = {
    startDay: 45,
    durationDays: 10,
    sourceStage: activeWorkflowStages[0] ?? "",
    targetStage: activeWorkflowStages[1] ?? activeWorkflowStages[0] ?? "",
    capacityShift: 0.5,
    rampUpEffectiveness: 0.75,
  };
  const swarmForm = swarmDraft ?? savedSwarm ?? workflowConfig.swarm ?? fallbackSwarm;
  const openGameView = () => {
    if (visualization === "kanban" && !("dailyLog" in selected)) setVisualization("cfd");
    setFocusMode(true);
  };

  const saveProjectFile = () => {
    const project = createProjectFile(selectedConfig, seed, projectName.trim() || "FlowLab project");
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "flowlab-project"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const loadProjectFile = async (file?: File) => {
    if (!file) return;
    try {
      const project = parseProjectFile(await file.text());
      const config = configFromProjectFile(project);
      setSeedInput(String(project.seed));
      setProjectName(project.name);
      setWorkflow(config.workflow.stages);
      setWorkflowInput(config.workflow.stages.join(", "));
      setProjectHeaderOverrides({
        label: config.label,
        summary: config.summary,
        horizonDays: config.horizonDays,
        warmupDays: config.warmupDays,
        initialBacklog: config.initialBacklog,
        batchDays: config.batchDays,
        batchSize: config.batchSize,
        serviceEffort: config.serviceEffort,
      });
      setSavedArrivalRate(config.arrivalRatePerDay);
      setArrivalRateInput(String(config.arrivalRatePerDay));
      setSavedWipAssistanceEffectiveness(config.wipAssistanceEffectiveness ?? 0.75);
      setWipAssistanceInput(String(config.wipAssistanceEffectiveness ?? 0.75));
      setSavedInitialInventory(config.initialInventory ?? (config.initialBacklog ? { [config.workflow.stages[0]]: config.initialBacklog } : {}));
      setSavedFeatureBacklog(config.featureBacklog ?? defaultFeatureBacklog);
      setFeatureBacklogDraft(config.featureBacklog ?? defaultFeatureBacklog);
      setSavedRates(config.baseRates as Record<string, number>);
      setRateDraft({});
      setSavedOperatingAssumptions(config.operatingAssumptions ?? {});
      setOperatingDraft({});
      setSavedWipLimits(config.wipLimits);
      setWipLimitDraft({});
      setSavedIncident(config.incident);
      setSavedSwarm(config.swarm);
      setSavedFeatureFocus(config.featureFocus ?? null);
      setFeatureFocusEnabled(config.featureFocus !== undefined);
      setFeatureFocusStartDay(String(config.featureFocus?.startDay ?? 0));
      setPhasePlan(phasePlanFromProject(project));
      setPhasePlanError(undefined);
      setSelectedDay(0);
      setProjectFileError(undefined);
      setRunKey((value) => value + 1);
    } catch (error) {
      setProjectFileError(error instanceof Error ? error.message : "Unable to load this project file.");
    } finally {
      if (projectFileInput.current) projectFileInput.current.value = "";
    }
  };

  const updatePhaseDuration = (id: string, value: string) => {
    const durationDays = Number(value);
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      setPhasePlanError("A phase duration must be a positive whole number.");
      return;
    }
    setPhasePlan((plan) => plan.map((phase) => phase.id === id ? { ...phase, durationDays } : phase));
    setPhasePlanError(undefined);
  };

  const updatePhaseIntervention = (id: string, intervention: keyof PhaseInterventions, enabled: boolean) => {
    setPhasePlan((plan) => plan.map((phase) => phase.id === id
      ? { ...phase, scenarioId: undefined, interventions: { ...phaseInterventionsForEntry(phase), [intervention]: enabled } }
      : phase));
    setPhasePlanError(undefined);
  };

  const updatePhaseCapacity = (id: string, stage: string, value: string) => {
    const capacity = Number(value);
    if (!Number.isFinite(capacity) || capacity <= 0) {
      setPhasePlanError(`The daily capacity for ${stage} must be greater than zero.`);
      return;
    }
    setPhasePlan((plan) => plan.map((phase) => {
      if (phase.id !== id) return phase;
      // A phase starts with the current project settings, then retains only
      // its own capacity adjustment as the plan is edited.
      const settings = phase.settings ?? phaseSettingsFor(customizedConfig);
      return {
        ...phase,
        settings: {
          ...settings,
          baseRates: { ...settings.baseRates, [stage]: capacity },
        },
      };
    }));
    setPhasePlanError(undefined);
  };

  const movePhase = (id: string, direction: -1 | 1) => {
    setPhasePlan((plan) => {
      const index = plan.findIndex((phase) => phase.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= plan.length) return plan;
      const next = [...plan];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removePhase = (id: string) => {
    if (phasePlan.length === 1) return;
    setPhasePlan((plan) => plan.filter((phase) => phase.id !== id));
    setPhasePlanError(undefined);
  };

  const addPhase = () => {
    setPhasePlan((plan) => [...plan, { id: `phase-${Date.now()}`, interventions: noPhaseInterventions(), durationDays: 20 }]);
    setPhasePlanError(undefined);
  };

  const saveWorkflow = () => {
    try {
      const nextWorkflow = workflowInput.split(",");
      withWorkflow(projectBaseConfig, nextWorkflow);
      const normalizedWorkflow = nextWorkflow.map((stage) => stage.trim());
      setWorkflow(normalizedWorkflow);
      setSavedRates({});
      setRateDraft({});
      setSavedOperatingAssumptions({});
      setOperatingDraft({});
      setSavedWipLimits((limits) => limits && Object.fromEntries(
        normalizedWorkflow.slice(1, -1).flatMap((stage) => limits[stage] === undefined ? [] : [[stage, limits[stage]]]),
      ));
      setWipLimitDraft({});
      setSavedIncident(undefined);
      setSavedSwarm(undefined);
      setIncidentDraft(undefined);
      setSwarmDraft(undefined);
      setWorkflowError(undefined);
      setSelectedDay(50);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Unable to save this workflow.");
    }
  };

  const saveRates = () => {
    try {
      const arrivalRate = Number(arrivalRateInput);
      const wipAssistanceEffectiveness = Number(wipAssistanceInput);
      const rates = Object.fromEntries(activeWorkflowStages.map((stage) => [
        stage,
        Number(rateDraft[stage] ?? selectedConfig.baseRates[stage] ?? 1),
      ]));
      const operatingAssumptions = Object.fromEntries(activeWorkflowStages.map((stage) => [
        stage,
        operatingDraft[stage] ?? selectedConfig.operatingAssumptions?.[stage] ?? { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 },
      ]));
      const wipLimits = Object.fromEntries(wipLimitStages.map((stage) => [
        stage,
        Number(wipLimitDraft[stage] ?? selectedConfig.wipLimits?.[stage] ?? 5),
      ]));
      withSimulationSettings(workflowConfig, { arrivalRatePerDay: arrivalRate, wipAssistanceEffectiveness, baseRates: rates, operatingAssumptions, wipLimits, incident: savedIncident, swarm: savedSwarm });
      setSavedArrivalRate(arrivalRate);
      setSavedWipAssistanceEffectiveness(wipAssistanceEffectiveness);
      setSavedRates(rates);
      setRateDraft({});
      setSavedOperatingAssumptions(operatingAssumptions);
      setOperatingDraft({});
      setSavedWipLimits(wipLimits);
      setWipLimitDraft({});
      setPhasePlan((plan) => plan.map((phase) => ({ ...phase, settings: undefined })));
      setCapacityError(undefined);
      setArrivalRateError(undefined);
      setCapacityModalOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save capacity allocation.";
      if (message.includes("backlog push rate")) {
        setArrivalRateError(message);
        setCapacityError(undefined);
      } else {
        setCapacityError(message);
        setArrivalRateError(undefined);
      }
    }
  };

  const saveFeatureBacklog = () => {
    try {
      withSimulationSettings(workflowConfig, { featureBacklog: featureBacklogDraft });
      setSavedFeatureBacklog(featureBacklogDraft);
      setFeatureBacklogError(undefined);
    } catch (error) {
      setFeatureBacklogError(error instanceof Error ? error.message : "Unable to save the feature-backed backlog.");
    }
  };

  const saveFeatureFocus = () => {
    try {
      const featureFocus = featureFocusEnabled ? { startDay: Number(featureFocusStartDay) } : null;
      withSimulationSettings(workflowConfig, { featureFocus });
      setSavedFeatureFocus(featureFocus);
      setFeatureFocusError(undefined);
    } catch (error) {
      setFeatureFocusError(error instanceof Error ? error.message : "Unable to save finishing-focus settings.");
    }
  };

  const saveIncident = () => {
    try {
      withSimulationSettings(workflowConfig, { baseRates: savedRates, incident: incidentForm, swarm: savedSwarm });
      setSavedIncident(incidentForm);
      setIncidentDraft(undefined);
      setInterventionError(undefined);
    } catch (error) {
      setInterventionError(error instanceof Error ? error.message : "Unable to save incident settings.");
    }
  };

  const saveSwarm = () => {
    try {
      withSimulationSettings(workflowConfig, { baseRates: savedRates, incident: savedIncident, swarm: swarmForm });
      setSavedSwarm(swarmForm);
      setSwarmDraft(undefined);
      setInterventionError(undefined);
    } catch (error) {
      setInterventionError(error instanceof Error ? error.message : "Unable to save scheduled capacity transfer settings.");
    }
  };

  const updateOperatingAssumption = (stage: string, field: keyof OperatingAssumptions, value: string) => {
    const current = operatingDraft[stage] ?? selectedConfig.operatingAssumptions?.[stage] ?? { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 };
    setOperatingDraft((draft) => ({ ...draft, [stage]: { ...current, [field]: Number(value) } }));
  };

  const closeCapacityModal = () => {
    setCapacityModalOpen(false);
    setArrivalRateInput(String(savedArrivalRate));
    setWipAssistanceInput(String(savedWipAssistanceEffectiveness));
    setRateDraft({});
    setOperatingDraft({});
    setWipLimitDraft({});
    setCapacityError(undefined);
    setArrivalRateError(undefined);
  };

  const runSimulation = () => {
    try {
      const seedCount = validateMeanSeedCount(Number(meanSeedCountInput));
      setMeanSeedCount(seedCount);
      setMeanSeedError(undefined);
      setRunKey((value) => value + 1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save simulation settings.";
      setMeanSeedError(message);
    }
  };

  return (
    <main className={`cockpit${focusMode ? " focus-mode" : ""}`}>
      <header className="topbar">
        <div>
          <p className="eyebrow">FlowLab · simulation cockpit</p>
          <h1>Product flow</h1>
        </div>
      </header>

      <div className="cockpit-workspace">
        <aside className="control-rail" aria-label="Simulation controls">
          <section className="panel-section seed-control">
            <p className="eyebrow">Run</p>
            <label htmlFor="seed">First seed</label>
            <div>
              <input id="seed" value={seedInput} onChange={(event) => setSeedInput(event.target.value)} inputMode="numeric" />
            </div>
            <label htmlFor="mean-seed-count">Mean CFD seeds</label>
            <div>
              <input id="mean-seed-count" type="number" min="1" step="1" value={meanSeedCountInput} onChange={(event) => setMeanSeedCountInput(event.target.value)} />
              <button type="button" onClick={runSimulation}>Run</button>
            </div>
            <small>{meanSeedCount === 1 ? "Run one reproducible simulation." : `Averaging seeds ${seed}–${seed + meanSeedCount - 1}.`}</small>
            {meanSeedError && <p className="settings-error" role="alert">{meanSeedError}</p>}
          </section>

          <section className="panel-section project-file-control" aria-labelledby="project-file-heading">
            <p className="eyebrow">Portable setup</p>
            <h2 id="project-file-heading">Project file</h2>
            <p>Load a time-phased simulation or download the current setup as JSON.</p>
            <label htmlFor="project-name">Project name</label>
            <input id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            <div className="project-file-actions">
              <button type="button" onClick={() => projectFileInput.current?.click()}>Load file</button>
              <button type="button" onClick={saveProjectFile}>Save file</button>
            </div>
            <input ref={projectFileInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void loadProjectFile(event.target.files?.[0])} />
            <div className="phase-plan-editor" aria-labelledby="phase-plan-heading">
              <h3 id="phase-plan-heading">Phase plan</h3>
              <p>Each duration is in working days. The plan determines when the simulation stops.</p>
              <small>WIP limits cap admission. Swarming shares unused capacity with a bottleneck. Backlog ranking selects the highest-ranked eligible Backlog work first.</small>
              {phasePlan.map((phase, index) => {
                const startDay = phasePlan.slice(0, index).reduce((total, entry) => total + entry.durationDays, 0);
                const endDay = startDay + phase.durationDays - 1;
                const interventions = phaseInterventionsForEntry(phase);
                return <fieldset key={phase.id}>
                  <legend>Days {startDay}–{endDay}</legend>
                  <div className="phase-intervention-list" aria-label="Phase interventions">
                    <label><input type="checkbox" checked={interventions.wipLimits} onChange={(event) => updatePhaseIntervention(phase.id, "wipLimits", event.target.checked)} />WIP limits</label>
                    <label><input type="checkbox" checked={interventions.featureFocus} onChange={(event) => updatePhaseIntervention(phase.id, "featureFocus", event.target.checked)} />Swarming</label>
                    <label><input type="checkbox" checked={interventions.backlogRanking} onChange={(event) => updatePhaseIntervention(phase.id, "backlogRanking", event.target.checked)} />Order backlog by ranking</label>
                  </div>
                  <div className="phase-capacity-list" aria-label="Phase capacity per day">
                    <span>Capacity / day</span>
                    {activeWorkflowStages.map((stage) => <label key={stage}>{stage}
                      <input
                        aria-label={`${stage} capacity for days ${startDay} to ${endDay}`}
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={phase.settings?.baseRates[stage] ?? customizedConfig.baseRates[stage] ?? 1}
                        onChange={(event) => updatePhaseCapacity(phase.id, stage, event.target.value)}
                      />
                    </label>)}
                  </div>
                  <label>Days<input type="number" min="1" step="1" value={phase.durationDays} onChange={(event) => updatePhaseDuration(phase.id, event.target.value)} /></label>
                  <div className="phase-plan-actions">
                    <button type="button" disabled={index === 0} onClick={() => movePhase(phase.id, -1)}>↑</button>
                    <button type="button" disabled={index === phasePlan.length - 1} onClick={() => movePhase(phase.id, 1)}>↓</button>
                    <button type="button" disabled={phasePlan.length === 1} onClick={() => removePhase(phase.id)}>Remove</button>
                  </div>
                </fieldset>;
              })}
              <button type="button" onClick={addPhase}>Add phase</button>
              <small>Simulation horizon: {phasePlanHorizon} working days.</small>
              {phasePlanError && <p className="settings-error" role="alert">{phasePlanError}</p>}
            </div>
            <div className="project-phase-list" aria-label="Project settings timeline">
              {projectPhases.map((phase) => <p key={phase.id}><strong>Day {phase.startDay}–{phase.endDay}</strong> {phase.label}</p>)}
            </div>
            {projectFileError && <p className="settings-error" role="alert">{projectFileError}</p>}
          </section>

          <section className="panel-section workflow-editor" aria-labelledby="workflow-heading">
            <p className="eyebrow">Customize</p>
            <h2 id="workflow-heading">Workflow</h2>
            <p>States in flow order, separated by commas.</p>
            <p><strong>Integration</strong> is the default passive handoff buffer: it is visible on the board and CFD, but has no processing capacity of its own.</p>
            <label htmlFor="workflow-states">Workflow states</label>
            <div className="workflow-editor-controls">
              <input id="workflow-states" value={workflowInput} onChange={(event) => setWorkflowInput(event.target.value)} />
              <button type="button" onClick={saveWorkflow}>Save</button>
            </div>
            {workflowError && <p className="workflow-error" role="alert">{workflowError}</p>}
          </section>

          <section className="panel-section capacity-launcher" aria-labelledby="capacity-launcher-heading">
            <p className="eyebrow">Global model</p>
            <h2 id="capacity-launcher-heading">Capacity & concurrency</h2>
            <p>Set global rates, WIP limits, Swarming effectiveness, and operating concurrency without adding detail to the phase plan.</p>
            <button type="button" onClick={() => setCapacityModalOpen(true)}>Configure capacity & concurrency</button>
          </section>

          <details className="settings-panel">
            <summary>Initial feature backlog</summary>
            <div className="feature-backlog-settings">
              <p>Feature-backed backlog</p>
              <label>Initial features<input type="number" min="0" step="1" value={featureBacklogDraft.featureCount} onChange={(event) => setFeatureBacklogDraft((draft) => ({ ...draft, featureCount: Number(event.target.value) }))} /></label>
              <label>PBIs / feature (min)<input type="number" min="1" step="1" value={featureBacklogDraft.minPbisPerFeature} onChange={(event) => setFeatureBacklogDraft((draft) => ({ ...draft, minPbisPerFeature: Number(event.target.value) }))} /></label>
              <label>PBIs / feature (max)<input type="number" min="1" step="1" value={featureBacklogDraft.maxPbisPerFeature} onChange={(event) => setFeatureBacklogDraft((draft) => ({ ...draft, maxPbisPerFeature: Number(event.target.value) }))} /></label>
              <label>Base Bug effort<input type="number" min="0.01" step="0.1" value={featureBacklogDraft.baseBugEffort} onChange={(event) => setFeatureBacklogDraft((draft) => ({ ...draft, baseBugEffort: Number(event.target.value) }))} /></label>
              <label>Feedback-delay factor<input type="number" min="0" step="0.05" value={featureBacklogDraft.feedbackDelayEffortFactor} onChange={(event) => setFeatureBacklogDraft((draft) => ({ ...draft, feedbackDelayEffortFactor: Number(event.target.value) }))} /></label>
              <button type="button" onClick={saveFeatureBacklog}>Save feature backlog</button>
              {featureBacklogError && <p className="settings-error" role="alert">{featureBacklogError}</p>}
            </div>
          </details>

          <details className="settings-panel">
            <summary>Interventions</summary>
            <section className="intervention-editor" aria-labelledby="completion-focus-heading">
              <h2 id="completion-focus-heading">Swarming</h2>
              <p>Unused capacity can support work at a constrained stage. Swarming does not change work priority; with WIP limits and Backlog ranking, it directs help to the highest-ranked active work without blocking other eligible work.</p>
              <label className="completion-focus-toggle"><span>Enable swarming</span><input type="checkbox" checked={featureFocusEnabled} onChange={(event) => setFeatureFocusEnabled(event.target.checked)} /></label>
              <label>Start day<input type="number" min="0" step="1" disabled={!featureFocusEnabled} value={featureFocusStartDay} onChange={(event) => setFeatureFocusStartDay(event.target.value)} /></label>
              <button type="button" onClick={saveFeatureFocus}>Save swarming</button>
              {featureFocusError && <p className="settings-error" role="alert">{featureFocusError}</p>}
            </section>
            <section className="intervention-editor" aria-labelledby="incident-heading">
              <h2 id="incident-heading">Capacity incident</h2>
              <label>Stage
                <select value={incidentForm.stage} onChange={(event) => setIncidentDraft({ ...incidentForm, stage: event.target.value })}>
                  {activeWorkflowStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                </select>
              </label>
              <div className="compact-fields">
                <label>Start day<input type="number" min="0" value={incidentForm.startDay} onChange={(event) => setIncidentDraft({ ...incidentForm, startDay: Number(event.target.value) })} /></label>
                <label>End day<input type="number" min="0" value={incidentForm.endDay} onChange={(event) => setIncidentDraft({ ...incidentForm, endDay: Number(event.target.value) })} /></label>
              </div>
              <label>Rate per day<input type="number" min="0.01" step="0.05" value={incidentForm.ratePerDay} onChange={(event) => setIncidentDraft({ ...incidentForm, ratePerDay: Number(event.target.value) })} /></label>
              <button type="button" onClick={saveIncident}>Save incident</button>
            </section>

            <section className="intervention-editor" aria-labelledby="scheduled-capacity-transfer-heading">
              <h2 id="scheduled-capacity-transfer-heading">Scheduled capacity transfer</h2>
              <p>Move a fixed amount of capacity between selected stages for a fixed period. This is separate from automatic Swarming.</p>
              <div className="compact-fields">
                <label>From
                  <select value={swarmForm.sourceStage} onChange={(event) => setSwarmDraft({ ...swarmForm, sourceStage: event.target.value })}>
                    {activeWorkflowStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                  </select>
                </label>
                <label>To
                  <select value={swarmForm.targetStage} onChange={(event) => setSwarmDraft({ ...swarmForm, targetStage: event.target.value })}>
                    {activeWorkflowStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                  </select>
                </label>
              </div>
              <div className="compact-fields">
                <label>Start day<input type="number" min="0" value={swarmForm.startDay} onChange={(event) => setSwarmDraft({ ...swarmForm, startDay: Number(event.target.value) })} /></label>
                <label>Days<input type="number" min="1" value={swarmForm.durationDays} onChange={(event) => setSwarmDraft({ ...swarmForm, durationDays: Number(event.target.value) })} /></label>
              </div>
              <label>Capacity shift<input type="number" min="0.01" step="0.05" value={swarmForm.capacityShift} onChange={(event) => setSwarmDraft({ ...swarmForm, capacityShift: Number(event.target.value) })} /></label>
              <label>First-day effectiveness<input type="number" min="0" max="1" step="0.05" value={swarmForm.rampUpEffectiveness} onChange={(event) => setSwarmDraft({ ...swarmForm, rampUpEffectiveness: Number(event.target.value) })} /></label>
              <button type="button" onClick={saveSwarm}>Save scheduled transfer</button>
            </section>
            {interventionError && <p className="settings-error" role="alert">{interventionError}</p>}
          </details>

          <details className="model-notes">
            <summary>Model notes</summary>
            <p>Without a Development WIP limit, the daily push rate releases Backlog work into Development. A Development WIP limit changes that admission to pull.</p>
            <p>WIP limits never transfer capacity, so unused capacity stays idle unless Swarming is active. Swarming reassigns unused capacity to a bottleneck.</p>
            <p>Backlog ranking selects the highest-ranked eligible Backlog work first. Work already in flight keeps its downstream queue order, preventing a mid-project ranking change from starving it and increasing feedback delay. WIP limits, Swarming, and Backlog ranking together activate priority focus: WIP stays bounded, bottlenecks are supported, and capacity concentrates on the highest-ranked active work without leaving other capacity idle.</p>
            <p>Integration holds finished Development work until Test accepts it; it never receives capacity or concurrency settings.</p>
            <p>Compare cycle time, completions, and queue-days—not just the shape of the CFD.</p>
          </details>
        </aside>

        <section className="cfd-canvas" aria-label="Simulation visualization workspace">
          <div className={`visualization-tabs${focusMode ? " game-view-tabs" : ""}`} role="tablist" aria-label="Simulation visualizations">
            <button type="button" role="tab" aria-selected={visualization === "cfd"} className={visualization === "cfd" ? "active" : ""} onClick={() => setVisualization("cfd")}>CFD</button>
            <button type="button" role="tab" aria-selected={visualization === "kanban"} className={visualization === "kanban" ? "active" : ""} onClick={() => setVisualization("kanban")}>Kanban</button>
            {!focusMode && <button type="button" className="game-view-button" onClick={openGameView}>Game view</button>}
          </div>
          {visualization === "cfd" ? (
            <CfdChart result={selected} selectedDay={visibleSelectedDay} onSelectDay={setSelectedDay} showInactiveWork={showInactiveWork} onShowInactiveWorkChange={setShowInactiveWork} showFeatureCompletions={showFeatureCompletions} onShowFeatureCompletionsChange={setShowFeatureCompletions} showFeatureHandoffs={showFeatureHandoffs} onShowFeatureHandoffsChange={setShowFeatureHandoffs} focusMode={focusMode} onExitFocusMode={() => setFocusMode(false)} />
          ) : "dailyLog" in selected ? (
            <KanbanBoard result={selected} selectedDay={visibleSelectedDay} onSelectDay={setSelectedDay} focusMode={focusMode} onExitFocusMode={() => setFocusMode(false)} />
          ) : (
            <section className="kanban-empty"><p className="eyebrow">Item trace</p><h2>Kanban board</h2><p>Run one seed to inspect individual items. A mean CFD has no single set of cards.</p></section>
          )}
        </section>

        <aside className="inspector-rail" aria-label="Simulation inspection">
          <section className="metrics" aria-label="Scenario comparison">
            <div className="rail-heading">
              <p className="eyebrow">Readout</p>
              <h2>Metrics</h2>
            </div>
            {metricLabels.map(([key, label, help]) => {
              const value = selected.metrics[key];
              const baselineValue = baseline.metrics[key];
              const delta = Number(value ?? 0) - Number(baselineValue ?? 0);
              const higherIsBetter = key === "completedItems";
              const comparisonClass = delta === 0 ? "neutral" : (higherIsBetter ? delta > 0 : delta < 0) ? "improved" : "worse";
              return (
                <article key={key} title={help}>
                  <span>{label}</span>
                  <strong>{formatMetric(key, value)}</strong>
                  <small className={comparisonClass}>
                    {isBaselinePlan ? "Reference" : `${delta > 0 ? "+" : ""}${formatMetric(key, delta)} vs baseline`}
                  </small>
                </article>
              );
            })}
          </section>

          <details className="log-drawer">
            <summary>Daily movement log</summary>
            {"dailyLog" in selected ? (
              <DailyLog entries={selected.dailyLog} snapshots={selected.snapshots} stages={selected.config.workflow.stages} seed={selected.seed} />
            ) : (
              <p className="mean-log-note">Daily movement rows belong to an individual simulation. Select one mean-CFD seed to inspect its log.</p>
            )}
          </details>
        </aside>
      </div>
      {capacityModalOpen && <div className="capacity-modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeCapacityModal();
      }}>
        <section className="capacity-modal" role="dialog" aria-modal="true" aria-labelledby="capacity-modal-heading" tabIndex={-1} onKeyDown={(event) => {
          if (event.key === "Escape") closeCapacityModal();
        }}>
          <header className="capacity-modal-header">
            <div>
              <p className="eyebrow">Global model</p>
              <h2 id="capacity-modal-heading">Capacity & concurrency</h2>
            </div>
            <button type="button" className="modal-close" aria-label="Close capacity settings" onClick={closeCapacityModal}>×</button>
          </header>
          <p className="capacity-modal-intro">These settings apply across the simulation. Phase-plan entries choose when WIP limits, Swarming, and Backlog ranking are active.</p>
          <div className="capacity-modal-global">
            <label className="arrival-rate-field" htmlFor="arrival-rate">
              <span>Average backlog pushes / day</span>
              <input id="arrival-rate" type="number" min="0" step="0.1" value={arrivalRateInput} onChange={(event) => setArrivalRateInput(event.target.value)} />
            </label>
            <label className="arrival-rate-field" htmlFor="wip-assistance-effectiveness">
              <span>Swarming effectiveness <small>(only when Swarming is enabled)</small></span>
              <input id="wip-assistance-effectiveness" type="number" min="0" max="1" step="0.05" value={wipAssistanceInput} onChange={(event) => setWipAssistanceInput(event.target.value)} />
            </label>
          </div>
          <section className="capacity-modal-section" aria-labelledby="stage-capacity-heading">
            <h3 id="stage-capacity-heading">Processing capacity & concurrency</h3>
            <p>Only active stages process work. Their rate is shared by actively worked cards.</p>
            <div className="stage-allocation-list">
              {activeWorkflowStages.map((stage) => {
                const assumptions = operatingDraft[stage] ?? selectedConfig.operatingAssumptions?.[stage] ?? { focusWip: 5, maximumConcurrency: 16, taskSwitchingLossRatio: 0.2 };
                return (
                  <fieldset key={stage}>
                    <legend>{stage}</legend>
                    <label htmlFor={`rate-${stage}`}>Daily processing rate<input id={`rate-${stage}`} type="number" min="0.01" step="0.05" value={rateDraft[stage] ?? String(selectedConfig.baseRates[stage] ?? 1)} onChange={(event) => setRateDraft((draft) => ({ ...draft, [stage]: event.target.value }))} /></label>
                    <label>Focus WIP<input type="number" min="1" step="1" value={assumptions.focusWip} onChange={(event) => updateOperatingAssumption(stage, "focusWip", event.target.value)} /></label>
                    <label>Max concurrency<input type="number" min="1" step="1" value={assumptions.maximumConcurrency} onChange={(event) => updateOperatingAssumption(stage, "maximumConcurrency", event.target.value)} /></label>
                    <label>Task-switch loss ratio<input type="number" min="0" max="1" step="0.05" value={assumptions.taskSwitchingLossRatio} onChange={(event) => updateOperatingAssumption(stage, "taskSwitchingLossRatio", event.target.value)} /></label>
                  </fieldset>
                );
              })}
            </div>
          </section>
          <section className="capacity-modal-section" aria-labelledby="wip-limit-heading">
            <h3 id="wip-limit-heading">WIP limits</h3>
            <p>These limits apply whenever a phase enables WIP limits. A full limit blocks admission; unused capacity stays idle unless that phase also enables Swarming. Integration is a passive handoff stage, but can still have a WIP limit.</p>
            <div className="wip-limit-list">
              {wipLimitStages.map((stage) => <label key={stage}>{stage}<input type="number" min="0" step="1" value={wipLimitDraft[stage] ?? String(selectedConfig.wipLimits?.[stage] ?? 5)} onChange={(event) => setWipLimitDraft((draft) => ({ ...draft, [stage]: event.target.value }))} /></label>)}
            </div>
          </section>
          {capacityError && <p className="settings-error" role="alert">{capacityError}</p>}
          {arrivalRateError && <p className="settings-error" role="alert">{arrivalRateError}</p>}
          <footer className="capacity-modal-actions">
            <button type="button" className="secondary-button" onClick={closeCapacityModal}>Cancel</button>
            <button type="button" onClick={saveRates}>Save global settings</button>
          </footer>
        </section>
      </div>}
    </main>
  );
}
