import type { DailyMovement, ItemTimelineState, SimulationResult, Stage, WorkItem } from "./sim/types";
import { configForProjectDay } from "./sim/project";

function stateAtDay(item: WorkItem, day: number): ItemTimelineState | undefined {
  for (let index = item.history.length - 1; index >= 0; index -= 1) {
    if (item.history[index].day <= day) return item.history[index];
  }
  return undefined;
}

/** A card is active when it received processing capacity on the selected day. */
function wasProcessedOnDay(item: WorkItem, day: number): boolean {
  let latestIndex = -1;
  for (let index = item.history.length - 1; index >= 0; index -= 1) {
    if (item.history[index].day <= day) {
      latestIndex = index;
      break;
    }
  }
  if (latestIndex < 0 || item.history[latestIndex].day !== day) return false;
  const current = item.history[latestIndex];
  const previous = item.history[latestIndex - 1];
  return previous !== undefined && current.progressPercent !== previous.progressPercent;
}

function formatDay(day: number | undefined): string {
  return day === undefined ? "—" : `Day ${day}`;
}

function formatCapacity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function movementCount(movements: DailyMovement[], from: string, to: string): number {
  return movements.find((movement) => movement.from === from && movement.to === to)?.count ?? 0;
}

interface Props {
  result: SimulationResult;
  selectedDay: number;
  onSelectDay: (day: number) => void;
}

function compareCards(stage: Stage, rankBacklog: boolean, first: { item: WorkItem }, second: { item: WorkItem }): number {
  if (rankBacklog) {
    const firstRanking = first.item.ranking ?? Number.MAX_SAFE_INTEGER;
    const secondRanking = second.item.ranking ?? Number.MAX_SAFE_INTEGER;
    return firstRanking - secondRanking
      || first.item.positionId - second.item.positionId
      || first.item.id.localeCompare(second.item.id, undefined, { numeric: true });
  }
  return (first.item.enteredAt[stage] ?? first.item.arrivedAt) - (second.item.enteredAt[stage] ?? second.item.arrivedAt)
    || first.item.positionId - second.item.positionId
    || first.item.id.localeCompare(second.item.id, undefined, { numeric: true });
}

export function KanbanBoard({ result, selectedDay, onSelectDay }: Props) {
  const stages = result.config.workflow.stages;
  const { config: dayConfig, phase } = configForProjectDay(result.config, selectedDay);
  const rankBacklog = dayConfig.backlogRanking === true;
  const snapshot = result.snapshots[selectedDay];
  const dailyLog = result.dailyLog[selectedDay];
  const movements = dailyLog?.movements ?? [];
  const stageChanges = movements.reduce((total, movement) => total + (movement.from === "External" ? 0 : movement.count), 0);
  const externalArrivals = movementCount(movements, "External", stages[0]);
  const activeInterventions = [
    dayConfig.wipLimits && `WIP limits (${Object.entries(dayConfig.wipLimits).map(([stage, limit]) => `${stage}: ${limit}`).join(" · ")})`,
    dayConfig.featureFocus && `Swarming${dailyLog?.featureFocus ? ` · ${dailyLog.featureFocus.title}` : ""}`,
    dayConfig.backlogRanking && "Order backlog by ranking",
    dayConfig.incident && selectedDay >= dayConfig.incident.startDay && selectedDay <= dayConfig.incident.endDay
      && `Capacity incident · ${dayConfig.incident.stage}: ${formatCapacity(dayConfig.incident.ratePerDay)}/day`,
    dayConfig.swarm && selectedDay >= dayConfig.swarm.startDay && selectedDay < dayConfig.swarm.startDay + dayConfig.swarm.durationDays
      && `Swarm · ${dayConfig.swarm.sourceStage} → ${dayConfig.swarm.targetStage}`,
  ].filter((intervention): intervention is string => Boolean(intervention));
  const capacityByStage = new Map((snapshot?.operatingCapacity ?? []).map((capacity) => [capacity.stage, capacity]));
  const totalTaskSwitchingLoss = (snapshot?.operatingCapacity ?? []).reduce((total, capacity) => total + capacity.taskSwitchingLoss, 0);
  const assistance = snapshot?.capacityAssistance ?? [];
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
      <section className="kanban-day-summary" aria-labelledby="kanban-day-summary-title">
        <article className="kanban-summary-card capacity-summary">
          <div className="kanban-summary-heading">
            <p className="eyebrow">Daily summary</p>
            <h3 id="kanban-day-summary-title">What happened on Day {selectedDay}</h3>
          </div>
          <h4>Stage capacity</h4>
          <div className="kanban-capacity-table-wrap">
            <table>
              <thead><tr><th>Stage</th><th>Base</th><th>Effective</th><th>Active</th><th>Switch loss</th></tr></thead>
              <tbody>
                {stages.map((stage) => {
                  const capacity = capacityByStage.get(stage);
                  return <tr key={stage}>
                    <th scope="row">{stage}</th>
                    {capacity ? <>
                      <td>{formatCapacity(capacity.baseCapacity)}</td>
                      <td>{formatCapacity(capacity.effectiveCapacity)}</td>
                      <td>{capacity.concurrentItems}</td>
                      <td>{formatCapacity(capacity.taskSwitchingLoss)}</td>
                    </> : <td colSpan={4}>—</td>}
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <p>— = non-processing stage</p>
          {assistance.length > 0 && <p className="kanban-assistance">Assistance: {assistance.map((entry) => `${entry.from} → ${entry.to}: ${formatCapacity(entry.capacity)}`).join(" · ")}</p>}
        </article>
        <article className="kanban-summary-card interventions-summary">
          <h4>Active interventions</h4>
          {activeInterventions.length ? <ul>{activeInterventions.map((intervention) => <li key={intervention}>{intervention}</li>)}</ul> : <p>Baseline flow</p>}
          {phase && <small>Phase: {phase.label}</small>}
        </article>
        <article className="kanban-summary-card flow-summary">
          <h4>Today’s flow</h4>
          <dl>
            <div><dt>Stage changes</dt><dd>{stageChanges}</dd></div>
            <div><dt>New arrivals</dt><dd>{externalArrivals}</dd></div>
            <div><dt>Completed</dt><dd>{snapshot?.completions ?? 0}</dd></div>
            <div><dt>Task-switch loss</dt><dd>{formatCapacity(totalTaskSwitchingLoss)}</dd></div>
          </dl>
          {movements.some((movement) => movement.count > 0) && <p className="kanban-movements">{movements.filter((movement) => movement.count > 0).map((movement) => `${movement.from} → ${movement.to}: ${movement.count}`).join(" · ")}</p>}
        </article>
      </section>
      <div className="kanban-columns">
        {stages.map((stage) => {
          const cards = (cardsByStage.get(stage) ?? []).sort((first, second) => compareCards(stage, rankBacklog && stage === stages[0], first, second));
          return (
            <section className="kanban-column" key={stage} aria-label={`${stage}: ${cards.length} items`}>
              <h3>{stage}<small>{cards.length}</small></h3>
              <div className="kanban-cards">
                {cards.map(({ item, state }) => {
                  const activeToday = wasProcessedOnDay(item, selectedDay);
                  return <article className={`kanban-card ${activeToday ? "active" : "inactive"}`} key={item.id}>
                    <div className="kanban-card-heading"><span className={`item-type ${item.type.toLowerCase()}`}>{item.type}</span><strong>{item.id}</strong>{!activeToday && <span className="inactive-marker">Inactive</span>}</div>
                    <p>{item.title}</p>
                    <dl>
                      <div><dt>Stage</dt><dd>{state.stage}</dd></div>
                      <div><dt>Active today</dt><dd>{activeToday ? "Yes" : "No"}</dd></div>
                      <div><dt>Progress</dt><dd>{state.progressPercent.toFixed(0)}%</dd></div>
                      {item.featureId && <div><dt>Feature</dt><dd>{item.featureTitle ?? item.featureId}</dd></div>}
                      {item.ranking !== undefined && <div><dt>Ranking</dt><dd>{item.ranking}</dd></div>}
                      {item.originatingPbiId && <div><dt>Feedback for</dt><dd>{item.originatingPbiId}</dd></div>}
                      {item.feedbackDelayDays !== undefined && <div><dt>Delay</dt><dd>{item.feedbackDelayDays}d</dd></div>}
                      <div><dt>Start</dt><dd>{formatDay(state.startDate)}</dd></div>
                      <div><dt>Complete</dt><dd>{formatDay(state.completionDate)}</dd></div>
                    </dl>
                  </article>
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
