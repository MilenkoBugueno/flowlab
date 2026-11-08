import { describe, expect, it } from "vitest";
import { layoutFeatureCompletionMarkers } from "./featureMarkers";

describe("Feature completion marker layout", () => {
  it("gives same-day and adjacent-day completions separate visible markers", () => {
    const markers = layoutFeatureCompletionMarkers([
      { id: "FEATURE-001", title: "Feature 1", ranking: 1, pbiIds: [], bugIds: [], completedAt: 70 },
      { id: "FEATURE-002", title: "Feature 2", ranking: 2, pbiIds: [], bugIds: [], completedAt: 71 },
      { id: "FEATURE-003", title: "Feature 3", ranking: 3, pbiIds: [], bugIds: [], completedAt: 71 },
    ], (day) => day * 10);

    expect(markers).toHaveLength(3);
    expect(markers.map((marker) => marker.lane)).toEqual([0, 1, 2]);
  });
});
