import type { ItemTimelineState, SimulationResult, Stage, WorkItem } from "./sim/types";

function stateAtDay(item: WorkItem, day: number): ItemTimelineState | undefined {
  for (let index = item.history.length - 1; index >= 0; index -= 1) {
    if (item.history[index].day <= day) return item.history[index];
  }
  return undefined;
}

function formatDay(day: number | undefined): string {
  return day === undefined ? "—" : `Day ${day}`;
}

interface Props {
  result: SimulationResult;
  selectedDay: number;
  onSelectDay: (day: number) => void;
}

export function KanbanBoard({ result, selectedDay, onSelectDay }: Props) {
  const stages = result.config.workflow.stages;
  const cardsByStage = new Map<Stage, Array<{ item: WorkItem; state: ItemTimelineState }>>(
    stages.map((stage) => [stage, []]),
  );
  for (const item of result.items) {
    const state = stateAtDay(item, selectedDay);
    if (state) cardsByStage.get(state.stage)?.push({ item, state });
  }

  return (
    <section className="kanban-board" aria-labelledby="kanban-title">
      <header>
        <p className="eyebrow">Item trace</p>
        <div className="kanban-header-row">
          <h2 id="kanban-title">Kanban board · Day {selectedDay}</h2>
          <div className="kanban-day-control" aria-label="Kanban simulation day">
            <button type="button" onClick={() => onSelectDay(selectedDay - 1)} disabled={selectedDay === 0}>Previous day</button>
            <label htmlFor="kanban-day">Day<input id="kanban-day" type="number" min="0" max={result.config.horizonDays - 1} value={selectedDay} onChange={(event) => onSelectDay(Math.max(0, Math.min(result.config.horizonDays - 1, Number(event.target.value))))} /></label>
            <button type="button" onClick={() => onSelectDay(selectedDay + 1)} disabled={selectedDay === result.config.horizonDays - 1}>Next day</button>
          </div>
        </div>
        <p>Items created after this day are not shown.</p>
      </header>
      <div className="kanban-columns">
        {stages.map((stage) => {
          const cards = cardsByStage.get(stage) ?? [];
          return (
            <section className="kanban-column" key={stage} aria-label={`${stage}: ${cards.length} items`}>
              <h3>{stage}<small>{cards.length}</small></h3>
              <div className="kanban-cards">
                {cards.map(({ item, state }) => (
                  <article className={`kanban-card ${state.active ? "active" : "inactive"}`} key={item.id}>
                    <div className="kanban-card-heading"><span className={`item-type ${item.type.toLowerCase()}`}>{item.type}</span><strong>{item.id}</strong>{!state.active && <span className="inactive-marker">Inactive</span>}</div>
                    <p>{item.title}</p>
                    <dl>
                      <div><dt>Stage</dt><dd>{state.stage}</dd></div>
                      <div><dt>Active</dt><dd>{state.active ? "Yes" : "No"}</dd></div>
                      <div><dt>Progress</dt><dd>{state.progressPercent.toFixed(0)}%</dd></div>
                      {item.featureId && <div><dt>Feature</dt><dd>{item.featureTitle ?? item.featureId}</dd></div>}
                      {item.originatingPbiId && <div><dt>Feedback for</dt><dd>{item.originatingPbiId}</dd></div>}
                      {item.feedbackDelayDays !== undefined && <div><dt>Delay</dt><dd>{item.feedbackDelayDays}d</dd></div>}
                      <div><dt>Start</dt><dd>{formatDay(state.startDate)}</dd></div>
                      <div><dt>Complete</dt><dd>{formatDay(state.completionDate)}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
