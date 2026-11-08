import * as d3 from "d3";
import { useMemo, useRef } from "react";
import type { DailySnapshot, SimulationViewResult, Stage, WorkflowConfig } from "../sim/types";
import { activeStages } from "../sim/workflow";

const palette = ["#cbd5e1", "#38bdf8", "#fb923c", "#a78bfa", "#f472b6", "#facc15", "#34d399", "#60a5fa"];
const completedStageColor = "#34d399";

type ChartRow = { day: number } & Record<Stage, number>;

function phaseLabelLines(label: string, bandWidth: number): string[] {
  const maxCharacters = Math.max(8, Math.floor(bandWidth / 5));
  const words = label.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= maxCharacters) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface Props {
  result: SimulationViewResult;
  selectedDay: number;
  onSelectDay: (day: number) => void;
  showInactiveWork: boolean;
  onShowInactiveWorkChange: (show: boolean) => void;
  showFeatureCompletions: boolean;
  onShowFeatureCompletionsChange: (show: boolean) => void;
  showFeatureHandoffs: boolean;
  onShowFeatureHandoffsChange: (show: boolean) => void;
}

export function CfdChart({ result, selectedDay, onSelectDay, showInactiveWork, onShowInactiveWorkChange, showFeatureCompletions, onShowFeatureCompletionsChange, showFeatureHandoffs, onShowFeatureHandoffsChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { config, snapshots } = result;
  const meanRunCount = "seeds" in result ? result.seeds.length : 1;
  const workflowStages = config.workflow.stages;
  const stateOrder = [...workflowStages].reverse();
  const colours = Object.fromEntries(workflowStages.map((stage, index) => [
    stage,
    index === workflowStages.length - 1 ? completedStageColor : palette[index % palette.length],
  ]));
  const width = 920;
  const height = 390;
  const margin = { top: 58, right: 28, bottom: 52, left: 54 };
  const rows: ChartRow[] = useMemo(
    () => snapshots.map((snapshot) => ({ day: snapshot.day, ...snapshot.states })),
    [snapshots],
  );
  const stacked = useMemo(() => d3.stack<ChartRow>().keys(stateOrder)(rows), [rows, stateOrder]);
  const maxY = Math.max(1, d3.max(stacked, (series) => d3.max(series, (point) => point[1])) ?? 1);
  const x = d3.scaleLinear().domain([0, config.horizonDays - 1]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, maxY]).nice().range([height - margin.bottom, margin.top]);
  const phaseBands = (config.projectPhases ?? []).map((phase) => ({
    ...phase,
    left: x(phase.startDay),
    right: phase.endDay === config.horizonDays - 1 ? width - margin.right : x(phase.endDay + 1),
  }));
  const area = d3
    .area<d3.SeriesPoint<ChartRow>>()
    .x((point) => x(point.data.day))
    .y0((point) => y(point[0]))
    .y1((point) => y(point[1]));
  const activeArea = (series: d3.Series<ChartRow, Stage>) => d3
    .area<d3.SeriesPoint<ChartRow>>()
    .x((point) => x(point.data.day))
    .y0((point) => y(point[0]))
    .y1((point) => y(point[0] + Math.min(snapshots[point.data.day]?.active[series.key] ?? 0, point[1] - point[0])))(series);
  const selected = snapshots[selectedDay] ?? snapshots.at(-1);
  const ticks = x.ticks(6);
  const yTicks = y.ticks(5);
  const featureCompletions = "features" in result
    ? Array.from(
      result.features
        .filter((feature) => feature.completedAt !== undefined)
        .reduce((byDay, feature) => {
          const day = feature.completedAt as number;
          const titles = byDay.get(day) ?? [];
          titles.push(feature.title);
          byDay.set(day, titles);
          return byDay;
        }, new Map<number, string[]>()),
      ([day, titles]) => ({ day, titles }),
    )
    : [];
  const featureHandoffs = "features" in result
    ? Array.from(
      result.features
        .filter((feature) => feature.handoffAt !== undefined)
        .reduce((byDay, feature) => {
          const day = feature.handoffAt as number;
          const titles = byDay.get(day) ?? [];
          titles.push(feature.title);
          byDay.set(day, titles);
          return byDay;
        }, new Map<number, string[]>()),
      ([day, titles]) => ({ day, titles }),
    )
    : [];
  const canShowFeatureMarkers = "features" in result;
  const finalActiveStage = activeStages(config.workflow).at(-1) ?? workflowStages.at(-2) ?? "the final working stage";

  const selectFromPointer = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const plotFraction = Math.min(1, Math.max(0, (event.clientX - bounds.left - (margin.left / width) * bounds.width) / ((1 - (margin.left + margin.right) / width) * bounds.width)));
    onSelectDay(Math.round(plotFraction * (config.horizonDays - 1)));
  };

  return (
    <section className="chart-section" aria-labelledby="cfd-title">
      <div className="chart-header">
        <div>
          <p className="eyebrow">Cumulative flow diagram</p>
          <h2 id="cfd-title">Where work is accumulating</h2>
        </div>
        <div className="chart-controls">
          <p className="chart-hint">{meanRunCount > 1 ? `Mean of ${meanRunCount} simulations · select a day to inspect averages.` : "Select a day on the chart to inspect its queues."}</p>
          <label className="cfd-inactive-toggle"><input type="checkbox" checked={showInactiveWork} onChange={(event) => onShowInactiveWorkChange(event.target.checked)} />Show inactive work</label>
          <label className="cfd-feature-toggle" title={canShowFeatureMarkers ? "Show one marker per Feature completion day." : "Feature completion markers belong to individual simulation runs."}>
            <input type="checkbox" checked={showFeatureCompletions} disabled={!canShowFeatureMarkers} onChange={(event) => onShowFeatureCompletionsChange(event.target.checked)} />Show completed Features
          </label>
          <label className="cfd-feature-toggle" title={canShowFeatureMarkers ? `Show one marker when the last PBI in a Feature enters ${finalActiveStage}.` : "Feature handoff markers belong to individual simulation runs."}>
            <input type="checkbox" checked={showFeatureHandoffs} disabled={!canShowFeatureMarkers} onChange={(event) => onShowFeatureHandoffsChange(event.target.checked)} />Show Feature handoffs
          </label>
        </div>
      </div>
      <div className="legend" aria-label="CFD state legend">
        {stateOrder.map((stage) => (
          <span key={stage}><i style={{ backgroundColor: colours[stage] }} />{stage}</span>
        ))}
        {showInactiveWork && <>
          <span className="activity-key"><i className="active-key" />Active work</span>
          <span className="activity-key"><i className="inactive-key" />Inactive / waiting</span>
        </>}
        {showFeatureCompletions && canShowFeatureMarkers && <span className="feature-completion-key"><i />Feature completed</span>}
        {showFeatureHandoffs && canShowFeatureMarkers && <span className="feature-handoff-key"><i />Feature handed over</span>}
      </div>
      <svg
        ref={svgRef}
        className="cfd-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Cumulative flow diagram showing work in each configured workflow state over working days"
        onClick={selectFromPointer}
      >
        <defs>
          {workflowStages.map((stage, index) => (
            <pattern key={stage} id={`inactive-${index}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill={colours[stage]} opacity="0.28" />
              <line x1="0" y1="0" x2="0" y2="7" stroke={colours[stage]} strokeWidth="2" opacity="0.72" />
            </pattern>
          ))}
        </defs>
        {phaseBands.length > 0 && <g className="phase-labels" aria-label="Project phases">
          {phaseBands.map((phase) => {
            const bandWidth = Math.max(0, phase.right - phase.left);
            const labelLines = phaseLabelLines(phase.label, bandWidth);
            const firstLineY = 25 - (labelLines.length - 1) * 5;
            return <g key={phase.id}>
              <title>Days {phase.startDay}–{phase.endDay}: {phase.label}</title>
              <rect x={phase.left} y="4" width={bandWidth} height="34" className="phase-band" />
              <text
                x={phase.left + bandWidth / 2}
                y={firstLineY}
                className="phase-label"
                textAnchor="middle"
              >{labelLines.map((line, index) => <tspan key={`${phase.id}-${index}`} x={phase.left + bandWidth / 2} dy={index === 0 ? 0 : 10}>{line}</tspan>)}</text>
            </g>;
          })}
          <line x1={margin.left} x2={width - margin.right} y1="38" y2="38" className="phase-band-line" />
        </g>}
        <rect x={margin.left} y={margin.top} width={width - margin.left - margin.right} height={height - margin.top - margin.bottom} className="plot-background" />
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="grid-line" />
            <text x={margin.left - 10} y={y(tick) + 4} className="axis-text" textAnchor="end">{tick}</text>
          </g>
        ))}
        {stacked.map((series) => (
          <g key={series.key}>
            {series.key === workflowStages.at(-1) || !showInactiveWork ? (
              <path d={area(series) ?? ""} fill={colours[series.key]} className="area" />
            ) : (
              <>
                {showInactiveWork && <path d={area(series) ?? ""} fill={`url(#inactive-${workflowStages.indexOf(series.key)})`} className="area inactive-area" />}
                <path d={activeArea(series) ?? ""} fill={colours[series.key]} className="active-area" />
              </>
            )}
          </g>
        ))}
        {showFeatureCompletions && featureCompletions.map(({ day, titles }) => (
          <g key={`feature-completion-${day}`} className="feature-completion-marker">
            <title>{titles.length === 1 ? `${titles[0]} completed on day ${day}` : `${titles.length} Features completed on day ${day}`}</title>
            <line x1={x(day)} x2={x(day)} y1={margin.top} y2={height - margin.bottom} />
            <circle cx={x(day)} cy={margin.top + 10} r="7" />
            <path d={`M ${x(day) - 3} ${margin.top + 10} l 2.2 2.4 l 4.2 -5`} />
            {titles.length > 1 && <text x={x(day) + 10} y={margin.top + 14}>×{titles.length}</text>}
          </g>
        ))}
        {showFeatureHandoffs && featureHandoffs.map(({ day, titles }) => (
          <g key={`feature-handoff-${day}`} className="feature-handoff-marker">
            <title>{titles.length === 1 ? `${titles[0]} handed over to ${finalActiveStage} on day ${day}` : `${titles.length} Features handed over to ${finalActiveStage} on day ${day}`}</title>
            <line x1={x(day)} x2={x(day)} y1={margin.top} y2={height - margin.bottom} />
            <path d={`M ${x(day)} ${margin.top + 20} l 5 5 l -5 5 l -5 -5 Z`} />
            {titles.length > 1 && <text x={x(day) + 10} y={margin.top + 30}>×{titles.length}</text>}
          </g>
        ))}
        <line x1={x(selectedDay)} x2={x(selectedDay)} y1={margin.top} y2={height - margin.bottom} className="selected-day" />
        {config.incident && (
          <g>
            <line x1={x(config.incident.startDay)} x2={x(config.incident.startDay)} y1={margin.top} y2={height - margin.bottom} className="incident-line" />
            <text x={x(config.incident.startDay) + 4} y={margin.top + 14} className="annotation">Capacity incident</text>
          </g>
        )}
        {config.swarm && (
          <g>
            <line x1={x(config.swarm.startDay)} x2={x(config.swarm.startDay)} y1={margin.top} y2={height - margin.bottom} className="swarm-line" />
            <text x={x(config.swarm.startDay) + 4} y={margin.top + 30} className="annotation">Swarm begins</text>
          </g>
        )}
        {phaseBands.filter((phase) => phase.startDay > 0).map((phase) => (
          <g key={phase.id}>
            <line x1={x(phase.startDay)} x2={x(phase.startDay)} y1={margin.top} y2={height - margin.bottom} className="phase-line" />
          </g>
        ))}
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={height - margin.bottom} y2={height - margin.bottom + 5} className="axis-line" />
            <text x={x(tick)} y={height - margin.bottom + 22} className="axis-text" textAnchor="middle">Day {tick}</text>
          </g>
        ))}
        <text x={(margin.left + width - margin.right) / 2} y={height - 10} className="axis-label" textAnchor="middle">Working day</text>
        <text transform={`translate(16 ${(margin.top + height - margin.bottom) / 2}) rotate(-90)`} className="axis-label" textAnchor="middle">Items</text>
      </svg>
      {selected && <DayInspector snapshot={selected} workflow={config.workflow} />}
    </section>
  );
}

function DayInspector({ snapshot, workflow }: { snapshot: DailySnapshot; workflow: WorkflowConfig }) {
  const { stages } = workflow;
  const statesToInspect = stages.slice(0, -1);
  const active = new Set(activeStages(workflow));
  return (
    <div className="day-inspector" aria-live="polite">
      <div>
        <span className="eyebrow">Selected day</span>
        <strong>Day {snapshot.day}</strong>
      </div>
      <div><span>Arrived</span><strong>{formatCount(snapshot.arrivals)}</strong></div>
      <div><span>Completed</span><strong>{formatCount(snapshot.completions)}</strong></div>
      {snapshot.featureFocus && <div><span>Priority focus</span><strong>{snapshot.featureFocus.title}</strong></div>}
      {snapshot.projectPhase && <div><span>Project phase</span><strong>{snapshot.projectPhase.label}</strong></div>}
      {statesToInspect.map((stage) => (
        <div key={stage}><span>{stage}</span><strong>{formatCount(snapshot.states[stage])} {active.has(stage) && <small>({formatCount(snapshot.active[stage] ?? 0)} active)</small>}</strong></div>
      ))}
      {snapshot.operatingCapacity?.map((capacity) => (
        <div key={`${capacity.stage}-capacity`}><span>{capacity.stage} capacity</span><strong>{capacity.effectiveCapacity.toFixed(2)} <small>({capacity.taskSwitchingLoss.toFixed(2)} lost)</small></strong></div>
      ))}
    </div>
  );
}

function formatCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
