import { useMemo, useState } from "react";
import { CfdChart } from "./chart/CfdChart";
import { DailyLog } from "./DailyLog";
import { runScenario } from "./sim/engine";
import { scenarioList, scenarios } from "./sim/scenarios";
import type { Metrics, ScenarioId } from "./sim/types";
import { withWorkflow } from "./sim/workflow";

const metricLabels: Array<[keyof Metrics, string, string]> = [
  ["completedItems", "Completed items", "More is better, if cycle time remains healthy."],
  ["p85CycleTime", "p85 cycle time", "Days for 85% of completed work to flow through."],
  ["maxReviewWip", "Peak Review WIP", "The highest number of items in Code Review."],
  ["reviewQueueDays", "Review queue-days", "Total waiting pressure in Code Review."],
];

function formatMetric(key: keyof Metrics, value: Metrics[keyof Metrics]) {
  if (value === null) return "—";
  if (key === "p85CycleTime" || key === "medianCycleTime" || key === "meanWip" || key === "littlesLawEstimate") return Number(value).toFixed(1);
  return Number(value).toFixed(0);
}

export default function App() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>("baseline");
  const [seedInput, setSeedInput] = useState("42");
  const [runKey, setRunKey] = useState(0);
  const [workflowInput, setWorkflowInput] = useState(scenarios.baseline.workflow.stages.join(", "));
  const [workflow, setWorkflow] = useState(scenarios.baseline.workflow.stages);
  const [workflowError, setWorkflowError] = useState<string>();
  const seed = Number.isFinite(Number(seedInput)) ? Math.max(0, Math.floor(Number(seedInput))) : 42;
  const baseline = useMemo(() => runScenario(scenarios.baseline, seed), [seed, runKey]);
  const selectedConfig = useMemo(() => withWorkflow(scenarios[scenarioId], workflow), [scenarioId, workflow]);
  const selected = useMemo(() => runScenario(selectedConfig, seed), [selectedConfig, seed, runKey]);
  const [selectedDay, setSelectedDay] = useState(50);
  const scenario = scenarios[scenarioId];

  const updateScenario = (id: ScenarioId) => {
    setScenarioId(id);
    setSelectedDay(50);
  };

  const saveWorkflow = () => {
    try {
      const nextWorkflow = workflowInput.split(",");
      withWorkflow(scenarios[scenarioId], nextWorkflow);
      setWorkflow(nextWorkflow.map((stage) => stage.trim()));
      setWorkflowError(undefined);
      setSelectedDay(50);
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Unable to save this workflow.");
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
            <label htmlFor="seed">Simulation seed</label>
            <div>
              <input id="seed" value={seedInput} onChange={(event) => setSeedInput(event.target.value)} inputMode="numeric" />
              <button type="button" onClick={() => setRunKey((value) => value + 1)}>Run</button>
            </div>
            <small>Keep the seed to compare scenarios fairly.</small>
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
            <DailyLog entries={selected.dailyLog} stages={selected.config.workflow.stages} seed={selected.seed} />
          </details>
        </aside>
      </div>
    </main>
  );
}
