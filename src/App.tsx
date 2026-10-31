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
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">FlowLab · v1 prototype</p>
          <h1>See where product work is waiting—and what changes the flow.</h1>
          <p className="lede">A transparent simulation lab for comparing bottlenecks, swarming, and WIP limits. Every result uses the same seeded demand stream.</p>
        </div>
        <div className="seed-control">
          <label htmlFor="seed">Simulation seed</label>
          <div>
            <input id="seed" value={seedInput} onChange={(event) => setSeedInput(event.target.value)} inputMode="numeric" />
            <button type="button" onClick={() => setRunKey((value) => value + 1)}>Run simulation</button>
          </div>
          <small>Use the same seed to make a fair comparison.</small>
        </div>
      </header>

      <section className="scenario-section" aria-labelledby="scenario-heading">
        <div>
          <p className="eyebrow">Choose an intervention</p>
          <h2 id="scenario-heading">What should FlowLab test?</h2>
        </div>
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
        <p className="scenario-summary"><strong>{scenario.label}:</strong> {scenario.summary}</p>
      </section>

      <section className="workflow-editor" aria-labelledby="workflow-heading">
        <div>
          <p className="eyebrow">Customize the flow</p>
          <h2 id="workflow-heading">Workflow states</h2>
          <p>Enter states in the order work moves through them, separated by commas. The first state receives work and the last state completes it.</p>
        </div>
        <div>
          <label htmlFor="workflow-states">Workflow</label>
          <div className="workflow-editor-controls">
            <input id="workflow-states" value={workflowInput} onChange={(event) => setWorkflowInput(event.target.value)} />
            <button type="button" onClick={saveWorkflow}>Save workflow</button>
          </div>
          {workflowError && <p className="workflow-error" role="alert">{workflowError}</p>}
        </div>
      </section>

      <section className="metrics" aria-label="Scenario comparison">
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
                {scenarioId === "baseline" ? "Reference scenario" : `${delta > 0 ? "+" : ""}${formatMetric(key, delta)} vs baseline`}
              </small>
            </article>
          );
        })}
      </section>

      <CfdChart result={selected} selectedDay={selectedDay} onSelectDay={setSelectedDay} />

      <DailyLog entries={selected.dailyLog} stages={selected.config.workflow.stages} seed={selected.seed} />

      <section className="explainers">
        <article>
          <p className="eyebrow">How to read this</p>
          <h2>A widening band means work is accumulating.</h2>
          <p>The height of each band is work in that state. The gap between arrivals and completed work is the queue the team is carrying.</p>
        </article>
        <article>
          <p className="eyebrow">Model assumptions</p>
          <h2>No hidden capacity.</h2>
          <p>Swarming temporarily removes capacity from Development. WIP limits prevent work from entering a full state, so it stays visibly upstream rather than disappearing.</p>
        </article>
        <article>
          <p className="eyebrow">Check the trade-off</p>
          <h2>Don’t judge a prettier chart alone.</h2>
          <p>Compare tail cycle time, completions, and queue-days. A useful intervention reduces delay without merely moving it to another part of the system.</p>
        </article>
      </section>
    </main>
  );
}
