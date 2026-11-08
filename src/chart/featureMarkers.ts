import type { Feature } from "../sim/types";

export interface FeatureCompletionMarker {
  id: string;
  title: string;
  day: number;
  lane: number;
}

/**
 * Assign vertical lanes so every completed Feature is visible even when
 * completions occur on the same or adjacent working days.
 */
export function layoutFeatureCompletionMarkers(
  features: Feature[],
  xForDay: (day: number) => number,
  minimumHorizontalGap = 16,
): FeatureCompletionMarker[] {
  const lastXInLane: number[] = [];

  return features
    .filter((feature): feature is Feature & { completedAt: number } => feature.completedAt !== undefined)
    .sort((first, second) => first.completedAt - second.completedAt || first.ranking - second.ranking)
    .map((feature) => {
      const day = feature.completedAt;
      const markerX = xForDay(day);
      const availableLane = lastXInLane.findIndex((lastX) => markerX - lastX >= minimumHorizontalGap);
      const lane = availableLane === -1 ? lastXInLane.length : availableLane;
      lastXInLane[lane] = markerX;
      return { id: feature.id, title: feature.title, day, lane };
    });
}
