import { describe, expect, it } from "vitest";
import { translateGuiText } from "./i18n";

describe("GUI translations", () => {
  it("keeps English as the canonical UI language", () => {
    expect(translateGuiText("Completed items", "en")).toBe("Completed items");
  });

  it("translates fixed and dynamic GUI text to German", () => {
    expect(translateGuiText("Completed items", "de")).toBe("Abgeschlossene Elemente");
    expect(translateGuiText("Day 46", "de")).toBe("Tag 46");
    expect(translateGuiText("+3 vs baseline", "de")).toBe("+3 gegenüber Basislinie");
    expect(translateGuiText("Kanban board · Day 46", "de")).toBe("Kanban-Board · Tag 46");
  });
});
