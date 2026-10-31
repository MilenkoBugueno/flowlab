import { useMemo, useState } from "react";
import { CfdChart } from "./chart/CfdChart";
import { DailyLog } from "./DailyLog";
import { runScenario } from "./sim/engine";
import { runMeanScenario, validateMeanSeedCount } from "./sim/mean";
import { scenarioList, scenarios } from "./sim/scenarios";
import { withSimulationSettings } from "./sim/settings";
import type { CapacityIncident, Metrics, ScenarioId, SwarmPolicy } from "./sim/types";
import { activeStages, withWorkflow } from "./sim/workflow";

const metricLabels: Array<[keyof Metrics, string, string]> = [
  ["completedItems", "Completed items", "More is better, if cycle time remains healthy."],
  ["p85CycleTime", "p85 cycle time", "Days for 85% of completed work to flow through."],
  ["maxReviewWip", "Peak constraint WIP", "The highest number of items in the constrained workflow stage."],
  ["reviewQueueDays", "Constraint queue-days", "Total waiting pressure in the constrained workflow stage."],
];

function formatMetric(key: keyof Metrics, value: Metrics[keyof Metrics]) {
  if (value === null) return "—";
  if (key === "p85CycleTime" || key === "medianCycleTime" || key === "meanWip" || key === "littlesLawEstimate") return Number(value).toFixed(1);
  return Number(value).toFixed(0);
}

export default function App() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("baseline");
  const [seedInput, setSeedInput] = useState("42");
  const [arrivalRateInput, setArrivalRateInput] = useState(String(scenarios.baseline.arrivalRatePerDay));
  const [savedArrivalRate, setSavedArrivalRate] = useState(scenarios.baseline.arrivalRatePerDay);
  const [wipAssistanceInput, setWipAssistanceInput] = useState(String(scenarios.baseline.wipAssistanceEffectiveness ?? 0.75));
  const [savedWipAssistanceEffectiveness, setSavedWipAssistanceEffectiveness] = useState(scenarios.baseline.wipAssistanceEffectiveness ?? 0.75);
  const [arrivalRateError, setArrivalRateError] = useState<string>();
  const [meanSeedCountInput, setMeanSeedCountInput] = useState("1");
  const [meanSeedCount, setMeanSeedCount] = useState(1);
  const [meanSeedError, setMeanSeedError] = useState<string>();
  const [runKey, setRunKey] = useState(0);
  const [workflowInput, setWorkflowInput] = useState(scenarios.baseline.workflow.stages.join(", "));
  const [workflow, setWorkflow] = useState(scenarios.baseline.workflow.stages);
  const [workflowError, setWorkflowError] = useState<string>();
  const [savedRates, setSavedRates] = useState<Record<string, number>>({});
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [capacityError, setCapacityError] = useState<string>();
  const [savedIncident, setSavedIncident] = useState<CapacityIncident>();
  const [savedSwarm, setSavedSwarm] = useState<SwarmPolicy>();
  const [incidentDraft, setIncidentDraft] = useState<CapacityIncident>();
  const [swarmDraft, setSwarmDraft] = useState<SwarmPolicy>();
  const [interventionError, setInterventionError] = useState<string>();
  const seed = Number.isFinite(Number(seedInput)) ? Math.max(0, Math.floor(Number(seedInput))) : 42;
  const workflowConfig = useMemo(() => withWorkflow(scenarios[scenarioId], workflow), [scenarioId, workflow]);
  const selectedConfig = useMemo(
    () => withSimulationSettings(workflowConfig, { arrivalRatePerDay: savedArrivalRate, wipAssistanceEffectiveness: savedWipAssistanceEffectiveness, baseRates: savedRates, incident: savedIncident, swarm: savedSwarm }),
    [workflowConfig, savedArrivalRate, savedWipAssistanceEffectiveness, savedRates, savedIncident, savedSwarm],
  );
  const baselineConfig = useMemo(
    () => withSimulationSettings(scenarios.baseline, { arrivalRatePerDay: savedArrivalRate, wipAssistanceEffectiveness: savedWipAssistanceEffectiveness }),
    [savedArrivalRate, savedWipAssistanceEffectiveness],
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
  const scenario = scenarios[scenarioId];
  const activeWorkflowStages = activeStages(workflowConfig.workflow);
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

  const updateScenario = (id: ScenarioId) => {
    setScenarioId(id);
    setSelectedDay(50);
  };

  const saveWorkflow = () => {
    try {
      const nextWorkflow = workflowInput.split(",");
      withWorkflow(scenarios[scenarioId], nextWorkflow);
      setWorkflow(nextWorkflow.map((stage) => stage.trim()));
      setSavedRates({});
      setRateDraft({});
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
      withSimulationSettings(workflowConfig, { arrivalRatePerDay: arrivalRate, wipAssistanceEffectiveness, baseRates: rates, incident: savedIncident, swarm: savedSwarm });
      setSavedArrivalRate(arrivalRate);
      setSavedWipAssistanceEffectiveness(wipAssistanceEffectiveness);
      setSavedRates(rates);
      setRateDraft({});
      setCapacityError(undefined);
      setArrivalRateError(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save capacity allocation.";
      if (message.includes("arrival rate")) {
        setArrivalRateError(message);
        setCapacityError(undefined);
      } else {
        setCapacityError(message);
        setArrivalRateError(undefined);
      }
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
      setInterventionError(error instanceof Error ? error.message : "Unable to save swarm settings.");
    }
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
    <main className="cockpit">
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

          <section className="panel-section scenario-section" aria-labelledby="scenario-heading">
            <p className="eyebrow">Intervention</p>
            <h2 id="scenario-heading">Scenario</h2>
            <div className="scenario-tabs" role="tablist" aria-label="Simulation scenarios">
              {scenarioList.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={entry.id === scenarioId}
                  className={entry.id === scenarioId ? "active" : ""}
                  onClick={() => updateScenario(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="scenario-summary">{scenario.summary}</p>
          </section>

          <section className="panel-section workflow-editor" aria-labelledby="workflow-heading">
            <p className="eyebrow">Customize</p>
            <h2 id="workflow-heading">Workflow</h2>
            <p>States in flow order, separated by commas.</p>
            <label htmlFor="workflow-states">Workflow states</label>
            <div className="workflow-editor-controls">
              <input id="workflow-states" value={workflowInput} onChange={(event) => setWorkflowInput(event.target.value)} />
              <button type="button" onClick={saveWorkflow}>Save</button>
            </div>
            {workflowError && <p className="workflow-error" role="alert">{workflowError}</p>}
          </section>

          <details className="settings-panel" open>
            <summary>Capacity allocation</summary>
            <p>Set incoming demand and the daily processing rate for each active stage.</p>
            <label className="arrival-rate-field" htmlFor="arrival-rate">
              <span>Average arrivals / day</span>
              <input id="arrival-rate" type="number" min="0" step="0.1" value={arrivalRateInput} onChange={(event) => setArrivalRateInput(event.target.value)} />
            </label>
            <label className="arrival-rate-field" htmlFor="wip-assistance-effectiveness">
              <span>WIP assistance effectiveness</span>
              <input id="wip-assistance-effectiveness" type="number" min="0" max="1" step="0.05" value={wipAssistanceInput} onChange={(event) => setWipAssistanceInput(event.target.value)} />
            </label>
            <div className="rate-list">
              {activeWorkflowStages.map((stage) => (
                <label key={stage} htmlFor={`rate-${stage}`}>
                  <span>{stage}</span>
                  <input
                    id={`rate-${stage}`}
                    type="number"
                    min="0.01"
                    step="0.05"
                    value={rateDraft[stage] ?? String(selectedConfig.baseRates[stage] ?? 1)}
                    onChange={(event) => setRateDraft((draft) => ({ ...draft, [stage]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
            <button type="button" onClick={saveRates}>Save allocation</button>
            {capacityError && <p className="settings-error" role="alert">{capacityError}</p>}
            {arrivalRateError && <p className="settings-error" role="alert">{arrivalRateError}</p>}
          </details>

          <details className="settings-panel">
            <summary>Interventions</summary>
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

            <section className="intervention-editor" aria-labelledby="swarm-heading">
              <h2 id="swarm-heading">Swarm</h2>
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
              <button type="button" onClick={saveSwarm}>Save swarm</button>
            </section>
            {interventionError && <p className="settings-error" role="alert">{interventionError}</p>}
          </details>

          <details className="model-notes">
            <summary>Model notes</summary>
            <p>Swarming reassigns Development capacity. WIP limits keep constrained work visibly upstream.</p>
            <p>Compare cycle time, completions, and queue-days—not just the shape of the CFD.</p>
          </details>
        </aside>

        <section className="cfd-canvas" aria-label="Cumulative flow diagram workspace">
          <CfdChart result={selected} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
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
                    {scenarioId === "baseline" ? "Reference" : `${delta > 0 ? "+" : ""}${formatMetric(key, delta)} vs baseline`}
                  </small>
                </article>
              );
            })}
          </section>

          <details className="log-drawer">
            <summary>Daily movement log</summary>
            {"dailyLog" in selected ? (
              <DailyLog entries={selected.dailyLog} stages={selected.config.workflow.stages} seed={selected.seed} />
            ) : (
              <p className="mean-log-note">Daily movement rows belong to an individual simulation. Select one mean-CFD seed to inspect its log.</p>
            )}
          </details>
        </aside>
      </div>
    </main>
  );
}
