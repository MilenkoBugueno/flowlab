Feature: Initial backlog and simulated Kanban board

  A simulation can begin with a configured inventory of product backlog items
  (PBIs) and bugs in each non-terminal workflow stage. Each item remains
  individually traceable while the simulation applies the workflow's WIP
  limits, capacity, and operational concurrency settings in the background.

  Scenario: Configure the initial inventory for every non-terminal stage
    Given I am editing the initial workflow inventory
    When I set the initial inventory to 8 PBIs and 3 bugs in Backlog
    And I set the initial inventory to 2 PBIs and 1 bug in Development
    And I set the initial inventory to 1 PBI and 1 bug in Test
    Then the next simulation is seeded before day 0 with 11 items in Backlog
    And 3 items in Development
    And 2 items in Test
    And no initial work can be seeded directly into Done

  Scenario: Initial inventory fields follow a customized workflow
    Given a workflow with the states "Ready", "Discovery", "Development", "Test", and "Done"
    When I open the initial workflow inventory settings
    Then I can set an initial PBI and bug count for Ready, Discovery, Development, and Test
    And Done is not an initial-inventory stage

  Scenario: Seeded items retain their type and selected starting stage
    Given an initial inventory of 2 PBIs in Backlog, 1 bug in Development, and 1 PBI in Test
    When I inspect the Kanban board before the first simulated working day
    Then every seeded item has a unique ID and a non-empty title
    And each seeded item identifies whether it is a PBI or a bug
    And each seeded item appears in its configured starting stage
    And each seeded item is initially inactive with 0 percent simulated progress

  Scenario: Operational concurrency determines active work from a seeded stage inventory
    Given an initial inventory of 17 PBIs in Development
    And Development has a maximum concurrency of 16 items and no explicit Development WIP limit
    When I simulate day 0
    Then 16 seeded Development items are active or received Development capacity on day 0
    And 1 seeded Development item remains waiting in Development

  Scenario: A WIP limit does not discard work already seeded in a stage
    Given an initial inventory of 8 PBIs in Development
    And Development has an explicit WIP limit of 5 items
    When I simulate day 0
    Then all 8 seeded items remain represented in Development or downstream stages
    And the Development WIP limit blocks only later admissions into Development

  Scenario: Reject an invalid initial inventory count for a stage
    Given I am editing the initial workflow inventory
    When I set the initial Test bug count to -1
    Then I am told that the initial Test bug count must be a non-negative whole number
    And the initial workflow inventory settings remain unchanged

  Scenario: Configure the initial backlog by item type
    Given I am editing the initial backlog
    When I set the initial backlog to 8 PBIs and 3 bugs
    Then the next simulation is seeded before day 0 with 11 items in Backlog
    And the initial backlog contains 8 PBIs and 3 bugs
    And the configured daily push rate is retained

  Scenario: Initial backlog items have stable identifying information
    Given a simulation with an initial backlog of 2 PBIs and 1 bug
    When I simulate with seed 42
    Then every initial backlog item has a unique ID
    And every initial backlog item has a non-empty title
    And every initial backlog item identifies whether it is a PBI or a bug
    And the same seed produces the same initial item IDs, titles, and types

  Scenario: Initial backlog stays finite until it is admitted
    Given a simulation with an initial backlog of 2 PBIs and 1 bug
    When I simulate with seed 42
    Then the daily push rate creates no external work items
    And all 3 initial items remain in Backlog when the push rate is zero

  Scenario: The Kanban board shows the state of every item on a selected day
    Given a simulation with an initial backlog of 4 PBIs and 2 bugs
    When I inspect the Kanban board on day 0
    Then every item created on or before day 0 appears in exactly one workflow stage
    And each card shows its ID, title, stage, active status, progress, start date, and completion date
    And the number of cards in each stage matches the CFD state for that day

  Scenario: Items are pulled and worked according to configured capacity and concurrency
    Given a simulation with an initial backlog of 17 PBIs and no bugs
    And Development has a maximum concurrency of 16 items and no explicit Development WIP limit
    When I simulate day 0
    Then all 17 initial items have entered Development
    And 16 items are active in Development
    And 1 item is waiting in Development
    And only active items make progress on day 0

  Scenario: Explicit WIP limits keep initial backlog items upstream
    Given a simulation with an initial backlog of 8 PBIs and no bugs
    And Development has an explicit WIP limit of 6 items
    When I simulate day 0
    Then 6 items are in Development
    And 2 items remain in Backlog
    And the Kanban board shows the same distribution

  Scenario: Item progress changes only while an item is actively worked
    Given an initial backlog item that has not started active work
    When I inspect the item on day 0
    Then its progress is 0 percent
    And its start date is empty
    And its completion date is empty
    When the item becomes active in Development
    Then its start date is that simulation day
    And its progress increases while it receives Development capacity
    When the item waits without active work
    Then its progress does not change

  Scenario: Completing an item finalizes its item-level state
    Given an active initial backlog item with enough remaining work to finish today
    When the item completes the final workflow stage
    Then its stage is the configured final workflow stage
    And its active status is false
    And its progress is 100 percent
    And its completion date is that simulation day

  Scenario: Initial backlog settings reject invalid quantities
    Given I am editing the initial backlog
    When I set the initial PBI count to -1
    Then I am told that the initial PBI count must be a non-negative whole number
    And the initial backlog settings remain unchanged
    When I set the initial bug count to 1.5
    Then I am told that the initial bug count must be a non-negative whole number
    And the initial backlog settings remain unchanged
