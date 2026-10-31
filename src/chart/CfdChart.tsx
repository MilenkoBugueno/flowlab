import * as d3 from "d3";
import { useMemo, useRef } from "react";
import type { DailySnapshot, SimulationResult, Stage } from "../sim/types";

const stateOrder: Stage[] = ["done", "test", "review", "development", "ready"];
const colours: Record<Stage, string> = {
  ready: "#cbd5e1",
  development: "#38bdf8",
  review: "#fb923c",
  test: "#a78bfa",
  done: "#34d399",
};
const labels: Record<Stage, string> = {
  ready: "Ready",
  development: "Development",
  review: "Code review",
  test: "Test / release",
  done: "Done",
};

type ChartRow = { day: number } & Record<Stage, number>;

interface Props {
  result: SimulationResult;
  selectedDay: number;
  onSelectDay: (day: number) => void;
}

export function CfdChart({ result, selectedDay, onSelectDay }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { config, snapshots } = result;
  const width = 920;
  const height = 390;
  const margin = { top: 40, right: 28, bottom: 52, left: 54 };
  const rows: ChartRow[] = useMemo(
    () => snapshots.map((snapshot) => ({ day: snapshot.day, ...snapshot.states })),
    [snapshots],
  );
  const stacked = useMemo(() => d3.stack<ChartRow>().keys(stateOrder)(rows), [rows]);
  const maxY = Math.max(1, d3.max(stacked, (series) => d3.max(series, (point) => point[1])) ?? 1);
  const x = d3.scaleLinear().domain([0, config.horizonDays - 1]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, maxY]).nice().range([height - margin.bottom, margin.top]);
  const area = d3
    .area<d3.SeriesPoint<ChartRow>>()
    .x((point) => x(point.data.day))
    .y0((point) => y(point[0]))
    .y1((point) => y(point[1]));
  const selected = snapshots[selectedDay] ?? snapshots.at(-1);
  const ticks = x.ticks(6);
  const yTicks = y.ticks(5);

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
        <p className="chart-hint">Select a day on the chart to inspect its queues.</p>
      </div>
      <div className="legend" aria-label="CFD state legend">
        {stateOrder.map((stage) => (
          <span key={stage}><i style={{ backgroundColor: colours[stage] }} />{labels[stage]}</span>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="cfd-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Cumulative flow diagram showing work in each product-development state over working days"
        onClick={selectFromPointer}
      >
        <rect x={margin.left} y={margin.top} width={width - margin.left - margin.right} height={height - margin.top - margin.bottom} className="plot-background" />
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="grid-line" />
            <text x={margin.left - 10} y={y(tick) + 4} className="axis-text" textAnchor="end">{tick}</text>
          </g>
        ))}
        {stacked.map((series) => (
          <path key={series.key} d={area(series) ?? ""} fill={colours[series.key as Stage]} className="area" />
        ))}
        <line x1={x(selectedDay)} x2={x(selectedDay)} y1={margin.top} y2={height - margin.bottom} className="selected-day" />
        <line x1={x(config.incident.startDay)} x2={x(config.incident.startDay)} y1={margin.top} y2={height - margin.bottom} className="incident-line" />
        <text x={x(config.incident.startDay) + 4} y={margin.top + 14} className="annotation">Review capacity incident</text>
        {config.swarm && (
          <g>
            <line x1={x(config.swarm.startDay)} x2={x(config.swarm.startDay)} y1={margin.top} y2={height - margin.bottom} className="swarm-line" />
            <text x={x(config.swarm.startDay) + 4} y={margin.top + 30} className="annotation">Swarm begins</text>
          </g>
        )}
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={height - margin.bottom} y2={height - margin.bottom + 5} className="axis-line" />
            <text x={x(tick)} y={height - margin.bottom + 22} className="axis-text" textAnchor="middle">Day {tick}</text>
          </g>
        ))}
        <text x={(margin.left + width - margin.right) / 2} y={height - 10} className="axis-label" textAnchor="middle">Working day</text>
        <text transform={`translate(16 ${(margin.top + height - margin.bottom) / 2}) rotate(-90)`} className="axis-label" textAnchor="middle">Items</text>
      </svg>
      {selected && <DayInspector snapshot={selected} />}
    </section>
  );
}

function DayInspector({ snapshot }: { snapshot: DailySnapshot }) {
  const stagesToInspect: Stage[] = ["ready", "development", "review", "test"];
  return (
    <div className="day-inspector" aria-live="polite">
      <div>
        <span className="eyebrow">Selected day</span>
        <strong>Day {snapshot.day}</strong>
      </div>
      <div><span>Arrived</span><strong>{snapshot.arrivals}</strong></div>
      <div><span>Completed</span><strong>{snapshot.completions}</strong></div>
      {stagesToInspect.map((stage) => (
        <div key={stage}><span>{labels[stage]}</span><strong>{snapshot.states[stage]} <small>({snapshot.active[stage as keyof typeof snapshot.active] ?? 0} active)</small></strong></div>
      ))}
    </div>
  );
}
