import type { DailyLogEntry, DailyMovement, DailySnapshot, Stage } from "./sim/types";

function routesFor(stages: Stage[]): Array<Pick<DailyMovement, "from" | "to">> {
  return [
    { from: "External", to: stages[0] },
    ...stages.slice(0, -1).map((from, index) => ({ from, to: stages[index + 1] })),
  ];
}

function movementCount(entry: DailyLogEntry, route: Pick<DailyMovement, "from" | "to">): number {
  return entry.movements.find((movement) => movement.from === route.from && movement.to === route.to)?.count ?? 0;
}

interface Props {
  entries: DailyLogEntry[];
  snapshots: DailySnapshot[];
  stages: Stage[];
  seed: number;
}

export function DailyLog({ entries, snapshots, stages, seed }: Props) {
  const routes = routesFor(stages);
  return (
    <section className="daily-log-section" aria-labelledby="daily-log-title">
      <div className="daily-log-header">
        <div>
          <p className="eyebrow">Simulation audit trail</p>
          <h2 id="daily-log-title">Daily movement log</h2>
        </div>
        <p>Seed {seed} · item movements completed on each working day</p>
      </div>
      <div className="daily-log-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {routes.map((route) => <th key={`${route.from}-${route.to}`} scope="col">{route.from} → {route.to}</th>)}
              <th scope="col">Task-switch loss</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.day}>
                <th scope="row">{entry.day}</th>
                {routes.map((route) => <td key={`${route.from}-${route.to}`}>{movementCount(entry, route)}</td>)}
                <td>{(snapshots[entry.day]?.operatingCapacity ?? []).reduce((total, capacity) => total + capacity.taskSwitchingLoss, 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
