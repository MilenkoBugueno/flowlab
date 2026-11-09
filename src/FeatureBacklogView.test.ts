import { describe, expect, it } from "vitest";
import { featureHierarchyForDay } from "./FeatureBacklogView";
import type { SimulationResult, WorkItem } from "./sim/types";

describe("Feature backlog hierarchy", () => {
  it("orders Features by rank and attaches feedback Bugs directly to their Feature", () => {
    const pbi = {
      id: "PBI-001",
      feedbackBugId: "Bug-001",
      history: [
        { day: 0, stage: "Development", active: true, progressPercent: 20 },
        { day: 2, stage: "Test", active: true, progressPercent: 70 },
      ],
    } as WorkItem;
    const bug = {
      id: "Bug-001",
      originatingPbiId: "PBI-001",
      history: [{ day: 2, stage: "Backlog", active: false, progressPercent: 0 }],
    } as WorkItem;
    const result = {
      features: [
        { id: "FEATURE-002", title: "Later", ranking: 2, pbiIds: [], bugIds: [] },
        { id: "FEATURE-001", title: "First", ranking: 1, pbiIds: ["PBI-001"], bugIds: ["Bug-001"] },
      ],
      items: [pbi, bug],
    } as SimulationResult;

    const hierarchy = featureHierarchyForDay(result, 2);

    expect(hierarchy.map(({ feature }) => feature.id)).toEqual(["FEATURE-001", "FEATURE-002"]);
    expect(hierarchy[0].pbis[0]).toMatchObject({
      item: { id: "PBI-001" },
      state: { stage: "Test", progressPercent: 70 },
    });
    expect(hierarchy[0].bugs[0]).toMatchObject({
      item: { id: "Bug-001", originatingPbiId: "PBI-001" },
      state: { stage: "Backlog" },
    });
  });
});
