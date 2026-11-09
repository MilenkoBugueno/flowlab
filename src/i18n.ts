import { useEffect, useLayoutEffect } from "react";
import type { RefObject } from "react";

export type GuiLanguage = "en" | "de";

const storageKey = "flowlab-gui-language";

const german: Record<string, string> = {
  "FlowLab · simulation cockpit": "FlowLab · Simulationscockpit",
  "Product flow": "Produktfluss",
  "Language": "Sprache",
  "English": "Englisch",
  "Simulation controls": "Simulationssteuerung",
  "Run": "Simulation",
  "First seed": "Erster Seed",
  "Mean CFD seeds": "Seeds für mittleres CFD",
  "Run one reproducible simulation.": "Eine reproduzierbare Simulation ausführen.",
  "Portable setup": "Übertragbare Konfiguration",
  "Project file": "Projektdatei",
  "Load a time-phased simulation or download the current setup as JSON.": "Eine phasenbasierte Simulation laden oder die aktuelle Konfiguration als JSON herunterladen.",
  "Project name": "Projektname",
  "Load file": "Datei laden",
  "Save file": "Datei speichern",
  "Phase plan": "Phasenplan",
  "Each duration is in working days. The plan determines when the simulation stops.": "Jede Dauer wird in Arbeitstagen angegeben. Der Plan bestimmt, wann die Simulation endet.",
  "WIP limits cap admission. Swarming shares unused capacity with a bottleneck. Backlog ranking selects the highest-ranked eligible Backlog work first.": "WIP-Limits begrenzen die Aufnahme. Swarming teilt ungenutzte Kapazität mit einem Engpass. Die Backlog-Rangfolge wählt zuerst die berechtigte Backlog-Arbeit mit dem höchsten Rang.",
  "Phase interventions": "Phaseninterventionen",
  "WIP limits": "WIP-Limits",
  "WIP Limits": "WIP-Limits",
  "Order backlog by ranking": "Backlog nach Rangfolge ordnen",
  "Phase capacity per day": "Phasenkapazität pro Tag",
  "Capacity / day": "Kapazität / Tag",
  "Days": "Tage",
  "Remove": "Entfernen",
  "Add phase": "Phase hinzufügen",
  "Project settings timeline": "Zeitachse der Projekteinstellungen",
  "Customize": "Anpassen",
  "Workflow": "Workflow",
  "States in flow order, separated by commas.": "Zustände in Flussreihenfolge, durch Kommas getrennt.",
  "is the default passive handoff buffer: it is visible on the board and CFD, but has no processing capacity of its own.": "ist der standardmäßige passive Übergabepuffer: Er ist auf Board und CFD sichtbar, hat aber keine eigene Verarbeitungskapazität.",
  "Workflow states": "Workflow-Zustände",
  "Save": "Speichern",
  "Global model": "Globales Modell",
  "Capacity & concurrency": "Kapazität & Parallelität",
  "Set global rates, WIP limits, Swarming effectiveness, and operating concurrency without adding detail to the phase plan.": "Globale Raten, WIP-Limits, Swarming-Wirksamkeit und operative Parallelität festlegen, ohne den Phasenplan weiter auszugestalten.",
  "Configure capacity & concurrency": "Kapazität & Parallelität konfigurieren",
  "Initial feature backlog": "Initialer Feature-Backlog",
  "Feature-backed backlog": "Feature-basierter Backlog",
  "Import a JSON file to preserve each initial Feature and PBI ID with its short title. Generated titles start empty.": "Importieren Sie eine JSON-Datei, um die IDs und Kurztitel aller initialen Features und PBIs zu erhalten. Generierte Kurztitel sind zunächst leer.",
  "Import initial backlog": "Initialen Backlog importieren",
  "Export initial backlog": "Initialen Backlog exportieren",
  "Imported initial backlog": "Importierter initialer Backlog",
  "Use generated backlog": "Generierten Backlog verwenden",
  "Initial features": "Initiale Features",
  "PBIs / feature (min)": "PBIs / Feature (min.)",
  "PBIs / feature (max)": "PBIs / Feature (max.)",
  "Base Bug effort": "Basisaufwand für Bugs",
  "Feedback-delay factor": "Feedback-Verzögerungsfaktor",
  "Save feature backlog": "Feature-Backlog speichern",
  "Interventions": "Interventionen",
  "Unused capacity can support work at a constrained stage. Swarming does not change work priority; with WIP limits and Backlog ranking, it directs help to the highest-ranked active work without blocking other eligible work.": "Ungenutzte Kapazität kann Arbeit in einer Engpassphase unterstützen. Swarming ändert nicht die Arbeitspriorität; zusammen mit WIP-Limits und Backlog-Rangfolge richtet es Hilfe auf die aktive Arbeit mit dem höchsten Rang, ohne andere berechtigte Arbeit zu blockieren.",
  "Enable swarming": "Swarming aktivieren",
  "Start day": "Starttag",
  "Save swarming": "Swarming speichern",
  "Capacity incident": "Kapazitätsstörung",
  "Stage": "Phase",
  "End day": "Endtag",
  "Rate per day": "Rate pro Tag",
  "Save incident": "Störung speichern",
  "Scheduled capacity transfer": "Geplanter Kapazitätstransfer",
  "Move a fixed amount of capacity between selected stages for a fixed period. This is separate from automatic Swarming.": "Eine feste Kapazitätsmenge für einen festen Zeitraum zwischen ausgewählten Phasen verschieben. Dies ist unabhängig vom automatischen Swarming.",
  "From": "Von",
  "To": "Nach",
  "Capacity shift": "Kapazitätsverschiebung",
  "First-day effectiveness": "Wirksamkeit am ersten Tag",
  "Save scheduled transfer": "Geplanten Transfer speichern",
  "Model notes": "Modellhinweise",
  "Without a Development WIP limit, the daily push rate releases Backlog work into Development. A Development WIP limit changes that admission to pull.": "Ohne WIP-Limit für Entwicklung bringt die tägliche Push-Rate Backlog-Arbeit in die Entwicklung. Ein WIP-Limit für Entwicklung ändert diese Aufnahme zu Pull.",
  "WIP limits never transfer capacity, so unused capacity stays idle unless Swarming is active. Swarming reassigns unused capacity to a bottleneck.": "WIP-Limits übertragen niemals Kapazität. Ungenutzte Kapazität bleibt daher untätig, außer Swarming ist aktiv. Swarming weist ungenutzte Kapazität einem Engpass zu.",
  "Backlog ranking selects the highest-ranked eligible Backlog work first. Work already in flight keeps its downstream queue order, preventing a mid-project ranking change from starving it and increasing feedback delay. WIP limits, Swarming, and Backlog ranking together activate priority focus: WIP stays bounded, bottlenecks are supported, and capacity concentrates on the highest-ranked active work without leaving other capacity idle.": "Die Backlog-Rangfolge wählt zuerst die berechtigte Backlog-Arbeit mit dem höchsten Rang. Bereits begonnene Arbeit behält ihre nachgelagerte Warteschlangenreihenfolge. So verhindert eine Rangänderung während des Projekts eine Verdrängung und längere Feedback-Verzögerungen. WIP-Limits, Swarming und Backlog-Rangfolge aktivieren zusammen den Prioritätsfokus: WIP bleibt begrenzt, Engpässe werden unterstützt und Kapazität konzentriert sich auf die aktive Arbeit mit dem höchsten Rang, ohne andere Kapazität untätig zu lassen.",
  "Integration holds finished Development work until Test accepts it; it never receives capacity or concurrency settings.": "Integration hält fertige Entwicklungsarbeit, bis Test sie übernimmt; sie erhält niemals Kapazitäts- oder Parallelitätseinstellungen.",
  "Compare cycle time, completions, and queue-days—not just the shape of the CFD.": "Vergleichen Sie Durchlaufzeit, Abschlüsse und Warteschlangentage – nicht nur die Form des CFD.",
  "Simulation visualization workspace": "Visualisierungsbereich der Simulation",
  "Simulation visualizations": "Simulationsvisualisierungen",
  "Game view": "Spielansicht",
  "Item trace": "Elementverfolgung",
  "Backlog hierarchy": "Backlog-Hierarchie",
  "Kanban board": "Kanban-Board",
  "Run one seed to inspect individual items. A mean CFD has no single set of cards.": "Führen Sie einen einzelnen Seed aus, um einzelne Elemente zu untersuchen. Ein mittleres CFD hat keinen einzelnen Kartensatz.",
  "Simulation inspection": "Simulationsanalyse",
  "Scenario comparison": "Szenariovergleich",
  "Readout": "Auswertung",
  "Metrics": "Kennzahlen",
  "Completed items": "Abgeschlossene Elemente",
  "Completed features": "Abgeschlossene Features",
  "p85 cycle time": "p85-Durchlaufzeit",
  "Peak constraint WIP": "Maximales Engpass-WIP",
  "Constraint queue-days": "Engpass-Warteschlangentage",
  "Task-switch loss": "Verlust durch Aufgabenwechsel",
  "More is better, if cycle time remains healthy.": "Mehr ist besser, sofern die Durchlaufzeit gesund bleibt.",
  "All features whose PBIs and generated feedback Bugs are Done in this simulation.": "Alle Features, deren PBIs und erzeugte Feedback-Bugs in dieser Simulation erledigt sind.",
  "Days from first active work to completion for 85% of completed work.": "Tage von der ersten aktiven Arbeit bis zum Abschluss für 85 % der abgeschlossenen Arbeit.",
  "The highest number of items in the constrained workflow stage.": "Die höchste Anzahl von Elementen in der eingeschränkten Workflow-Phase.",
  "Total waiting pressure in the constrained workflow stage.": "Gesamter Wartedruck in der eingeschränkten Workflow-Phase.",
  "Daily capacity lost to work beyond focus WIP.": "Tägliche Kapazität, die durch Arbeit über dem Fokus-WIP verloren geht.",
  "Reference": "Referenz",
  "Daily movement log": "Tägliches Bewegungsprotokoll",
  "Daily movement rows belong to an individual simulation. Select one mean-CFD seed to inspect its log.": "Tägliche Bewegungszeilen gehören zu einer einzelnen Simulation. Wählen Sie einen Seed des mittleren CFD, um sein Protokoll zu untersuchen.",
  "Close capacity settings": "Kapazitätseinstellungen schließen",
  "These settings apply across the simulation. Phase-plan entries choose when WIP limits, Swarming, and Backlog ranking are active.": "Diese Einstellungen gelten für die gesamte Simulation. Die Einträge des Phasenplans bestimmen, wann WIP-Limits, Swarming und Backlog-Rangfolge aktiv sind.",
  "Average backlog pushes / day": "Durchschnittliche Backlog-Pushes / Tag",
  "Swarming effectiveness ": "Swarming-Wirksamkeit ",
  "(only when Swarming is enabled)": "(nur wenn Swarming aktiviert ist)",
  "Processing capacity & concurrency": "Verarbeitungskapazität & Parallelität",
  "Only active stages process work. Their rate is shared by actively worked cards.": "Nur aktive Phasen verarbeiten Arbeit. Ihre Rate wird von aktiv bearbeiteten Karten geteilt.",
  "Daily processing rate": "Tägliche Verarbeitungsrate",
  "Focus WIP": "Fokus-WIP",
  "Max concurrency": "Max. Parallelität",
  "Task-switch loss ratio": "Verlustquote durch Aufgabenwechsel",
  "These limits apply whenever a phase enables WIP limits. A full limit blocks admission; unused capacity stays idle unless that phase also enables Swarming. Integration is a passive handoff stage, but can still have a WIP limit.": "Diese Limits gelten, sobald eine Phase WIP-Limits aktiviert. Ein volles Limit blockiert die Aufnahme; ungenutzte Kapazität bleibt untätig, außer diese Phase aktiviert auch Swarming. Integration ist eine passive Übergabephase, kann aber dennoch ein WIP-Limit haben.",
  "Cancel": "Abbrechen",
  "Save global settings": "Globale Einstellungen speichern",
  "Cumulative flow diagram": "Kumulatives Flussdiagramm",
  "Game view · Cumulative flow diagram": "Spielansicht · Kumulatives Flussdiagramm",
  "Where work is accumulating": "Wo sich Arbeit ansammelt",
  "Select a day on the chart to inspect its queues.": "Wählen Sie einen Tag im Diagramm, um die Warteschlangen zu untersuchen.",
  "Show inactive work": "Inaktive Arbeit anzeigen",
  "Show completed Features": "Abgeschlossene Features anzeigen",
  "Show Feature handoffs": "Feature-Übergaben anzeigen",
  "Exit game view": "Spielansicht beenden",
  "CFD state legend": "CFD-Zustandslegende",
  "Active work": "Aktive Arbeit",
  "Inactive / waiting": "Inaktiv / wartend",
  "Feature handed over": "Feature übergeben",
  "Cumulative flow diagram showing work in each configured workflow state over working days": "Kumulatives Flussdiagramm mit Arbeit in jedem konfigurierten Workflow-Zustand über die Arbeitstage",
  "Project phases": "Projektphasen",
  "Swarm begins": "Swarming beginnt",
  "Working day": "Arbeitstag",
  "Items": "Elemente",
  "Day": "Tag",
  "Selected day": "Ausgewählter Tag",
  "Arrived": "Angekommen",
  "Completed": "Abgeschlossen",
  "Priority focus": "Prioritätsfokus",
  "Project phase": "Projektphase",
  "Game view · Item trace": "Spielansicht · Elementverfolgung",
  "Kanban simulation day": "Kanban-Simulationstag",
  "Previous day": "Vorheriger Tag",
  "Next day": "Nächster Tag",
  "Items created after this day are not shown.": "Elemente, die nach diesem Tag erstellt wurden, werden nicht angezeigt.",
  "Daily summary": "Tagesübersicht",
  "Stage capacity": "Phasenkapazität",
  "Base": "Basis",
  "Effective": "Effektiv",
  "Active": "Aktiv",
  "Switch loss": "Wechselverlust",
  "— = non-processing stage": "— = nicht verarbeitende Phase",
  "Assistance: ": "Unterstützung: ",
  "Active interventions": "Aktive Interventionen",
  "Baseline flow": "Basisfluss",
  "Phase: ": "Phase: ",
  "Today’s flow": "Heutiger Fluss",
  "Stage changes": "Phasenwechsel",
  "New arrivals": "Neue Zugänge",
  "Inactive": "Inaktiv",
  "Active today": "Heute aktiv",
  "Yes": "Ja",
  "No": "Nein",
  "Progress": "Fortschritt",
  "Feature": "Feature",
  "Ranking": "Rangfolge",
  "Feedback for": "Feedback für",
  "Delay": "Verzögerung",
  "Start": "Start",
  "Complete": "Abschluss",
  "Game view · Feature map": "Spielansicht · Feature-Karte",
  "Feature map": "Feature-Karte",
  "Backlog hierarchy simulation day": "Simulationstag der Backlog-Hierarchie",
  "Features are ordered by rank. Expanded Features contain their PBIs and any Bugs raised for that Feature.": "Features sind nach Rangfolge sortiert. Aufgeklappte Features enthalten ihre PBIs und alle für dieses Feature erstellten Bugs.",
  "Features ordered by ranking": "Features nach Rangfolge",
  "Rank": "Rang",
  "PBIs ·": "PBIs ·",
  "raised Bugs": "erstellte Bugs",
  "In progress": "In Bearbeitung",
  "Not raised yet": "Noch nicht erstellt",
  "active": "aktiv",
  "feedback for": "Feedback für",
  "Simulation audit trail": "Prüfprotokoll der Simulation",
  "Seed ": "Seed ",
  "· item movements completed on each working day": "· an jedem Arbeitstag abgeschlossene Elementbewegungen",
  "Swarming assistance": "Swarming-Unterstützung",
  "Development": "Entwicklung",
  "Done": "Erledigt",
  "External": "Extern",
  "Baseline": "Basislinie",
};

function translateDynamicText(source: string): string {
  return source
    .replace(/\bWIP Limits\b/g, "WIP-Limits")
    .replace(/\bWIP limits\b/g, "WIP-Limits")
    .replace(/\bOrder backlog by ranking\b/g, "Backlog nach Rangfolge ordnen")
    .replace(/\bBaseline\b/g, "Basislinie")
    .replace(/\bKanban board\b/g, "Kanban-Board")
    .replace(/\bBacklog hierarchy\b/g, "Backlog-Hierarchie")
    .replace(/\bGame view\b/g, "Spielansicht")
    .replace(/\bCumulative flow diagram\b/g, "Kumulatives Flussdiagramm")
    .replace(/\bItem trace\b/g, "Elementverfolgung")
    .replace(/\bFeature map\b/g, "Feature-Karte")
    .replace(/\bFeature completed \(/g, "Feature abgeschlossen (")
    .replace(/\bRank\b/g, "Rang")
    .replace(/\braised Bugs\b/g, "erstellte Bugs")
    .replace(/\bIn progress\b/g, "In Bearbeitung")
    .replace(/\bDay\b/g, "Tag")
    .replace(/\bDays\b/g, "Tage")
    .replace(/\bcompleted on day (\d+)/g, "abgeschlossen an Tag $1")
    .replace(/\bhanded over to (.+) on day (\d+)/g, "übergeben an $1 an Tag $2")
    .replace(/\bFeatures handed over\b/g, "Features übergeben")
    .replace(/^Feature completed \((\d+)\)$/, "Feature abgeschlossen ($1)")
    .replace(/\((\d+(?:\.\d+)?) active\)/g, "($1 aktiv)")
    .replace(/\((\d+(?:\.\d+)?) lost\)/g, "($1 verloren)")
    .replace(/([+−-]?[\d.]+) vs baseline/g, "$1 gegenüber Basislinie")
    .replace(/Averaging seeds (\d+–\d+)\./, "Mittelwert der Seeds $1.")
    .replace(/Mean of (\d+) simulations · select a day to inspect averages\./, "Mittelwert aus $1 Simulationen · Wählen Sie einen Tag, um die Durchschnittswerte zu untersuchen.");
}

export function translateGuiText(source: string, language: GuiLanguage): string {
  if (language === "en") return source;
  const exact = german[source];
  if (exact) return exact;
  const leadingWhitespace = source.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = source.match(/\s*$/)?.[0] ?? "";
  const trimmed = source.trim();
  const trimmedTranslation = german[trimmed];
  if (trimmedTranslation) return `${leadingWhitespace}${trimmedTranslation}${trailingWhitespace}`;
  return translateDynamicText(source);
}

export function initialGuiLanguage(): GuiLanguage {
  try {
    return localStorage.getItem(storageKey) === "en" ? "en" : "de";
  } catch {
    return "de";
  }
}

interface LocalizationRecord {
  source: string;
  rendered: string;
}

const localizedTextNodes = new WeakMap<Text, LocalizationRecord>();
const localizedAttributes = new WeakMap<Element, Map<string, LocalizationRecord>>();
const localizableAttributes = ["aria-label", "title", "placeholder"];

function localizeTextNode(node: Text, language: GuiLanguage) {
  const value = node.nodeValue ?? "";
  const previous = localizedTextNodes.get(node);
  const source = !previous || value !== previous.rendered ? value : previous.source;
  const rendered = translateGuiText(source, language);
  localizedTextNodes.set(node, { source, rendered });
  if (value !== rendered) node.nodeValue = rendered;
}

function localizeAttribute(element: Element, attribute: string, language: GuiLanguage) {
  const value = element.getAttribute(attribute);
  if (value === null) return;
  const records = localizedAttributes.get(element) ?? new Map<string, LocalizationRecord>();
  const previous = records.get(attribute);
  const source = !previous || value !== previous.rendered ? value : previous.source;
  const rendered = translateGuiText(source, language);
  records.set(attribute, { source, rendered });
  localizedAttributes.set(element, records);
  if (value !== rendered) element.setAttribute(attribute, rendered);
}

/**
 * Applies the selected GUI language to the rendered product UI. The simulator's
 * configuration values remain canonical English so saved project files and
 * workflow behavior are unchanged.
 */
export function useGuiLocalization(root: RefObject<HTMLElement | null>, language: GuiLanguage) {
  useLayoutEffect(() => {
    document.documentElement.lang = language;
    const element = root.current;
    if (!element) return;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue?.trim() || node.parentElement?.closest("script, style")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    nodes.forEach((node) => localizeTextNode(node, language));
    element.querySelectorAll(localizableAttributes.map((attribute) => `[${attribute}]`).join(",")).forEach((node) => {
      localizableAttributes.forEach((attribute) => localizeAttribute(node, attribute, language));
    });
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, language);
    } catch {
      // A blocked storage area should not prevent a user from changing language.
    }
  }, [language]);
}
