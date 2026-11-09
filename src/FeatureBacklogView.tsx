import { useState } from "react";
import type { Feature, ItemTimelineState, SimulationResult, WorkItem } from "./sim/types";

export interface FeatureHierarchyPbi {
  item: WorkItem;
  state?: ItemTimelineState;
}

export interface FeatureHierarchyBug {
  item: WorkItem;
  state?: ItemTimelineState;
}

export interface FeatureHierarchy {
  feature: Feature;
  pbis: FeatureHierarchyPbi[];
  bugs: FeatureHierarchyBug[];
}

export function itemStateAtDay(item: WorkItem, day: number): ItemTimelineState | undefined {
  for (let index = item.history.length - 1; index >= 0; index -= 1) {
    if (item.history[index].day <= day) return item.history[index];
  }
  return undefined;
}

/*
 * Bugs belong to a Feature in the hierarchy. `originatingPbiId` remains useful
 * provenance, but it must not turn the view into a PBI → Bug tree.
 */
export function featureHierarchyForDay(result: SimulationResult, day: number): FeatureHierarchy[] {
  const itemById = new Map(result.items.map((item) => [item.id, item]));
  return [...result.features]
    .sort((first, second) => first.ranking - second.ranking)
    .map((feature) => ({
      feature,
      pbis: feature.pbiIds.flatMap((pbiId) => {
        const item = itemById.get(pbiId);
        return item ? [{ item, state: itemStateAtDay(item, day) }] : [];
      }),
      bugs: feature.bugIds.flatMap((bugId) => {
        const item = itemById.get(bugId);
        return item ? [{ item, state: itemStateAtDay(item, day) }] : [];
      }),
    }));
}

function stateSummary(state: ItemTimelineState | undefined): string {
  if (!state) return "Not raised yet";
  return `${state.stage}${state.active ? " · active" : ""} · ${state.progressPercent.toFixed(0)}%`;
}

interface Props {
  result: SimulationResult;
  selectedDay: number;
  onSelectDay: (day: number) => void;
  focusMode?: boolean;
  onExitFocusMode?: () => void;
}

export function FeatureBacklogView({ result, selectedDay, onSelectDay, focusMode = false, onExitFocusMode }: Props) {
  const hierarchy = featureHierarchyForDay(result, selectedDay);
  const [expandedFeatureIds, setExpandedFeatureIds] = useState<Set<string>>(() => new Set());
  const complete = (feature: Feature) => feature.completedAt !== undefined && feature.completedAt <= selectedDay;
  const toggleFeature = (featureId: string) => {
    setExpandedFeatureIds((expanded) => {
      const next = new Set(expanded);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  };

  return (
    <section className="feature-backlog-view" aria-labelledby="feature-backlog-title">
      <header>
        <p className="eyebrow">{focusMode ? "Game view · Feature map" : "Feature map"}</p>
        <div className="backlog-header-row">
          <h2 id="feature-backlog-title">Backlog hierarchy · Day {selectedDay}</h2>
          <div className="backlog-header-actions">
            <div className="kanban-day-control" aria-label="Backlog hierarchy simulation day">
              <button type="button" onClick={() => onSelectDay(selectedDay - 1)} disabled={selectedDay === 0}>Previous day</button>
              <label htmlFor="backlog-day">Day<input id="backlog-day" type="number" min="0" max={result.config.horizonDays - 1} value={selectedDay} onChange={(event) => onSelectDay(Math.max(0, Math.min(result.config.horizonDays - 1, Number(event.target.value))))} /></label>
              <button type="button" onClick={() => onSelectDay(selectedDay + 1)} disabled={selectedDay === result.config.horizonDays - 1}>Next day</button>
            </div>
            {focusMode && <button type="button" className="focus-exit-button" onClick={onExitFocusMode}>Exit game view <kbd>Esc</kbd></button>}
          </div>
        </div>
        <p>Features are ordered by rank. Expanded Features contain their PBIs and any Bugs raised for that Feature.</p>
      </header>
      <div className="feature-tree-list" role="tree" aria-label="Features ordered by ranking">
        {hierarchy.map(({ feature, pbis, bugs }) => {
          const expanded = expandedFeatureIds.has(feature.id);
          const raisedBugs = bugs.filter(({ state }) => state !== undefined);
          return <article className={`feature-tree${complete(feature) ? " completed" : ""}${expanded ? " expanded" : ""}`} key={feature.id} role="treeitem" aria-level={1} aria-expanded={expanded}>
            <button type="button" className="feature-tree-toggle" onClick={() => toggleFeature(feature.id)} aria-controls={`feature-children-${feature.id}`}>
              <span className="feature-tree-caret" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
              <span className="feature-tree-header">
                <span>
                  <span className="eyebrow">Feature</span>
                  <strong>{feature.title || feature.id}</strong>
                  {feature.title && <small className="feature-item-id">{feature.id}</small>}
                </span>
                <span className="feature-tree-meta">
                  <strong>Rank {feature.ranking}</strong>
                  <small>{pbis.length} PBIs · {raisedBugs.length} raised Bugs</small>
                  <small>{complete(feature) ? `Completed Day ${feature.completedAt}` : "In progress"}</small>
                </span>
              </span>
            </button>
            {expanded && <ol className="feature-tree-children" id={`feature-children-${feature.id}`} role="group">
              {pbis.map(({ item, state }) => (
                <li key={item.id} role="treeitem" aria-level={2}>
                  <article className="feature-tree-node pbi-node">
                    <div className="feature-tree-node-heading"><span className="tree-item-type">PBI</span><strong>{item.title || item.id}</strong>{item.title && <small className="tree-item-id">{item.id}</small>}</div>
                    <small>{stateSummary(state)}</small>
                  </article>
                </li>
              ))}
              {raisedBugs.map(({ item, state }) => (
                <li key={item.id} role="treeitem" aria-level={2}>
                  <article className="feature-tree-node bug-node">
                    <div className="feature-tree-node-heading"><span className="tree-item-type bug">Bug</span><strong>{item.title || item.id}</strong>{item.title && <small className="tree-item-id">{item.id}</small>}</div>
                    <small>{stateSummary(state)}{item.originatingPbiId ? ` · feedback for ${item.originatingPbiId}` : ""}</small>
                  </article>
                </li>
              ))}
            </ol>}
          </article>;
        })}
      </div>
    </section>
  );
}
