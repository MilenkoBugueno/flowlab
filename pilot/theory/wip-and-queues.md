# Theorieimpuls: WIP, Warteschlangen und Auslastung

## 1. Anschluss an das Spiel

Beginne mit zwei Fragen:

- Wie viele Features waren gestartet, aber noch nicht Done?
- Wie viel ihrer Kalenderzeit waren die Work Items tatsächlich aktiv in Arbeit?

Im Helios-Datensatz sind 18 Features gestartet und nur 4 Done. Viele ältere
Items verbringen mehr Zeit blockiert oder wartend als aktiv in Bearbeitung.

## 2. Zentrale Begriffe

- **WIP:** begonnene, aber noch nicht vollständig abgeschlossene Arbeit.
- **Warteschlange:** Arbeit, die auf eine benötigte Fähigkeit, Entscheidung,
  Ressource oder Information wartet.
- **Throughput:** pro Zeiteinheit vollständig abgeschlossene Arbeit.
- **Lead Time:** Kalenderzeit vom definierten Start bis zur Fertigstellung.

Als Denkmodell verbindet Little's Law stabile Durchschnittswerte:

> WIP = Throughput × Lead Time

Es ist keine Handlungsanweisung und erklärt allein noch keine Ursache. Es hilft
aber, widersprüchliche Aussagen zu prüfen.

## 3. Warum hohe Auslastung problematisch sein kann

Bei schwankender Ankunfts- und Bearbeitungszeit benötigt ein System freie
Kapazität, um Variation abzufedern. Wird jede lokale Ressource vollständig
verplant, werden kleine Schwankungen zu Warteschlangen. Lokale Effizienz kann
deshalb den End-to-End-Flow verschlechtern.

## 4. Typische Wirkungskette

Mehr Arbeit starten → mehr WIP → mehr Warten und Kontextwechsel → späteres
Feedback → teureres Rework → längere Lead Time.

## 5. Mögliche Gegenmaßnahmen

- WIP begrenzen und Arbeit pull-basiert beginnen,
- Fertigstellung über lokale Beschäftigung priorisieren,
- Engpässe sichtbar machen,
- bei blockierter Arbeit teamübergreifend unterstützen,
- Start- und Done-Definition eindeutig festlegen.

## 6. Grenzen

Ein WIP-Limit löst keine fehlende technische Fähigkeit, falsche Architektur oder
grundsätzlich unzureichende Kapazität. Es macht solche Probleme häufig früher
und deutlicher sichtbar. Kapazitätserhöhung kann sinnvoll sein, wenn der
Engpass nach Reduktion vermeidbarer Nachfrage bestehen bleibt.
