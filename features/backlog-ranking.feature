Feature: Rank Feature-backed backlog work

  FlowLab can apply an Order backlog by ranking intervention. Seeded Features
  receive a stable numeric ranking in creation order: Feature 001 has ranking
  1, Feature 002 has ranking 2, and so on. Ranking 1 is highest. Every PBI and
  feedback Bug linked to a Feature inherits that Feature's ranking.

  While this intervention is active, Backlog is ordered by ascending ranking.
  A higher-ranked item is always admitted to Development before a lower-ranked
  item, whether Development uses rate-based push or WIP-limited
  pull. Work that has already left Backlog is not moved or reordered.

  Scenario: Assign a stable ranking to every seeded Feature and its PBIs
    Given an initial backlog with 3 Features
    When I enable the Order backlog by ranking intervention from day 0
    Then Feature 001 has ranking 1
    And Feature 002 has ranking 2
    And Feature 003 has ranking 3
    And every PBI linked to a Feature has that Feature's ranking
    And the same seed assigns the same Feature and PBI rankings

  Scenario: Push higher-ranked backlog work before lower-ranked work
    Given an initial backlog with 3 ranked Features
    And Feature 002 is ahead of Feature 001 in the random backlog position order
    And Development can admit one item today without an explicit Development WIP limit
    When I simulate one working day with Order backlog by ranking active
    Then a PBI from Feature 001 enters Development
    And no PBI from Feature 002 or Feature 003 enters Development before Feature 001 work

  Scenario: Pull higher-ranked backlog work when Development has a WIP slot
    Given an initial backlog with 3 ranked Features
    And Development has a WIP limit of 1 and one free slot
    When Development pulls an item with Order backlog by ranking active
    Then a PBI from Feature 001 enters Development
    And lower-ranked Feature work remains in Backlog

  Scenario: Give feedback Bugs the ranking of their originating Feature
    Given Feature 002 has generated a feedback Bug
    When the Bug enters Backlog
    Then the Bug has ranking 2
    And the Bug is admitted before Backlog items with a ranking greater than 2

  Scenario: Reorder only Backlog work when the intervention begins mid-simulation
    Given a simulation where Feature 003 work is already in Development
    And ranked Feature 001 and Feature 002 work remain in Backlog
    When Order backlog by ranking begins on day 20
    Then Feature 003 work remains in Development or downstream
    And the next eligible Backlog admission is from Feature 001

  Scenario: Choose ranking order in a phase plan
    Given I am editing the phase plan
    When I add an Order backlog by ranking phase lasting 30 working days
    Then the phase plan shows Order backlog by ranking for its configured days
    And the saved project file retains the ranking-ordering phase
