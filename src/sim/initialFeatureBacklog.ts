import type { InitialFeatureBacklog, SimulationResult } from "./types";

export const INITIAL_FEATURE_BACKLOG_FORMAT_VERSION = 1 as const;

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function validateItem(value: unknown, label: string): { id: string; shortTitle: string } {
  assertRecord(value, label);
  if (typeof value.id !== "string" || !value.id.trim()) throw new Error(`${label} needs a non-empty ID.`);
  if (typeof value.shortTitle !== "string") throw new Error(`${label} needs a short title. It may be empty.`);
  return { id: value.id.trim(), shortTitle: value.shortTitle };
}

/** Validates a JSON-safe initial backlog, including IDs that will be used by the simulation. */
export function validateInitialFeatureBacklog(value: InitialFeatureBacklog): InitialFeatureBacklog {
  assertRecord(value, "Initial feature backlog");
  if (value.formatVersion !== INITIAL_FEATURE_BACKLOG_FORMAT_VERSION) {
    throw new Error("The initial feature backlog format version is not supported.");
  }
  if (!Array.isArray(value.features)) throw new Error("Initial feature backlog features must be an array.");

  const ids = new Set<string>();
  const uniqueItem = (item: { id: string; shortTitle: string }, label: string) => {
    if (ids.has(item.id)) throw new Error(`Initial feature backlog ID ${item.id} is duplicated.`);
    ids.add(item.id);
    return item;
  };
  return {
    formatVersion: INITIAL_FEATURE_BACKLOG_FORMAT_VERSION,
    features: value.features.map((valueFeature, featureIndex) => {
      const feature = uniqueItem(validateItem(valueFeature, `Feature ${featureIndex + 1}`), `Feature ${featureIndex + 1}`);
      const rawPbis = (valueFeature as unknown as Record<string, unknown>).pbis;
      if (!Array.isArray(rawPbis) || rawPbis.length === 0) throw new Error(`Feature ${feature.id} needs at least one PBI.`);
      return {
        ...feature,
        pbis: rawPbis.map((pbi, pbiIndex) => uniqueItem(validateItem(pbi, `PBI ${pbiIndex + 1} in Feature ${feature.id}`), `PBI ${pbiIndex + 1} in Feature ${feature.id}`)),
      };
    }),
  };
}

export function parseInitialFeatureBacklog(contents: string): InitialFeatureBacklog {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new Error("The selected initial feature backlog file is not valid JSON.");
  }
  return validateInitialFeatureBacklog(raw as InitialFeatureBacklog);
}

/** Creates a portable day-0 Feature/PBI file. Feedback Bugs are deliberately excluded. */
export function initialFeatureBacklogFromSimulation(result: SimulationResult): InitialFeatureBacklog {
  const items = new Map(result.items.map((item) => [item.id, item]));
  return validateInitialFeatureBacklog({
    formatVersion: INITIAL_FEATURE_BACKLOG_FORMAT_VERSION,
    features: [...result.features]
      .sort((first, second) => first.ranking - second.ranking)
      .map((feature) => ({
        id: feature.id,
        shortTitle: feature.title,
        pbis: feature.pbiIds.flatMap((pbiId) => {
          const pbi = items.get(pbiId);
          return pbi ? [{ id: pbi.id, shortTitle: pbi.title }] : [];
        }),
      })),
  });
}
