import type { DailyLogEntry, MovementRoute } from "./sim/types";

const routes: MovementRoute[] = [
  "external-to-ready",
  "ready-to-development",
  "development-to-review",
  "review-to-test",
  "test-to-done",
];

const labels: Record<MovementRoute, string> = {
  "external-to-ready": "External → Ready",
  "ready-to-development": "Ready → Development",
  "development-to-review": "Development → Review",
  "review-to-test": "Review → Test",
  "test-to-done": "Test → Done",
};

interface Props {
  entries: DailyLogEntry[];
  seed: number;
}

export function DailyLog({ entries, seed }: Props) {
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
              {routes.map((route) => <th key={route} scope="col">{labels[route]}</th>)}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.day}>
                <th scope="row">{entry.day}</th>
                {routes.map((route) => <td key={route}>{entry.movements[route]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
