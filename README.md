# FlowLab

FlowLab contains a browser-based product-flow simulation lab and the materials
for the accompanying moderated tabletop pilot. The simulation uses seeded
scenarios and cumulative flow diagrams (CFDs) to make queues, bottlenecks,
swarming, and WIP limits understandable.

## Shareable web deployment

The repository includes a GitHub Pages workflow. In GitHub, set **Settings →
Pages → Build and deployment → Source** to **GitHub Actions**. Every push to
`main` then publishes FlowLab at
`https://milenkobugueno.github.io/flowlab/`.

## Run the simulator locally

```sh
npm install
npm run dev
```

## Verify simulator behavior

```sh
npm test
```

The executable product behavior is expressed in `features/*.feature`. The
Cucumber steps exercise the simulation core directly; React and D3 render its
explicit daily snapshots and metrics.

The simulator includes Baseline, Start Finishing - Stop Starting, WIP Limits,
and WIP Limits + Start Finishing presets. It is a learning model, not a
calibrated prediction of a specific organization.

## Tabletop Pilot

FlowLab ist ein moderiertes Tabletop-Lernspiel, mit dem Produktentwickler lernen,
Product Development Flow anhand fragmentierter Projektdaten zu erkennen,
systemisch zu erklären und Verbesserungen zu erproben.

Dieses Repository enthält bewusst nur den Umfang für **Pilot 0**. Der Pilot
prüft eine erste vollständige Lernschleife zum Thema **Work in Progress (WIP),
Warteschlangen und lokale Auslastung**. Eine Software-Simulation ist für diesen
ersten Test nicht erforderlich; die Rückmeldung erfolgt mit vorbereiteten
Ergebnisprofilen.

## Pilot in drei Schritten

1. Lies [Pilotdesign](docs/pilot-design.md) und
   [Ablaufplan](pilot/run-of-show.md).
2. Drucke beziehungsweise verteile die Dateien unter `pilot/materials/` und
   die drei Projektartefakte unter `pilot/data/`.
3. Dokumentiere die Durchführung mit
   [Run Record](pilot/run/run-record-template.md).

## Inhalt

- `docs/`: Ziel, Scope und Designannahmen des Piloten
- `pilot/data/`: konsistente, synthetische Projektdaten
- `pilot/materials/`: Briefing, Rollen und Interventionen
- `pilot/theory/`: kurzer Theorie- und Debriefingbaustein
- `pilot/evaluation/`: formative Evaluation und Diagnose-Rubrik
- `pilot/run/`: Vorlage für die Durchführung
- `research/`: minimale wissenschaftliche Basis

## Datenschutz

Keine Namen, E-Mail-Adressen, Einwilligungen, Audio-/Videoaufnahmen oder nicht
anonymisierten Forschungsdaten in dieses Repository einchecken. Git speichert
Dateihistorien dauerhaft. Rohdaten gehören in eine institutionell freigegebene,
zugriffsgeschützte Ablage.

## Status

Version `0.1.0-pilot`: spielbarer, noch nicht validierter Pilotprototyp.
