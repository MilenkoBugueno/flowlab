Feature: Stop starting, start finishing

  A completion-focused intervention keeps the system focused on one Feature at
  a time. It stops additional Features from being started, gives the selected
  Feature priority through the workflow, and temporarily swarms available
  Development capacity to Test when Test is the selected Feature's constraint.

  The intervention is intended for feature-backed initial backlogs. Its default
  start day is day 0 and its focus limit is one unfinished Feature.

  Scenario: Select the oldest unfinished Feature when the intervention begins
    Given a feature-backed backlog with three Features in creation order
    And Stop starting, start finishing begins on day 0
    When I simulate the first working day
    Then Feature 001 is the current finishing focus
    And only Feature 001 work is admitted from Backlog into Development
    And Feature 002 and Feature 003 work remain in Backlog

  Scenario: Do not start a later Feature while the focused Feature is unfinished
    Given Feature 001 has unfinished PBIs or feedback Bugs
    And Development has free capacity
    When I simulate another working day with Stop starting, start finishing active
    Then no PBI or Bug belonging to a later Feature enters Development
    And available capacity is used only for Feature 001 work when such work is ready

  Scenario: Keep all PBIs of the focused Feature together at the test gate
    Given the focused Feature has multiple PBIs in Development
    When its PBIs complete Development at different times
    Then completed PBIs wait in Integration until the focused Feature's test gate opens
    And no later Feature is admitted while those PBIs wait
    And the focused PBIs enter Test according to the Test WIP limit and concurrency

  Scenario: Prioritize feedback Bugs as part of finishing the focused Feature
    Given a focused Feature PBI completes Test and creates a feedback Bug
    When the feedback Bug is ready to enter Development
    Then the feedback Bug is admitted before work from a later Feature
    And the next Feature remains stopped until that Bug reaches Done

  Scenario: Swarm available Development capacity to a focused Test constraint
    Given the focused Feature has ready work in Test
    And no focused Feature work can use Development capacity today
    When I simulate a working day with Stop starting, start finishing active
    Then available Development capacity is reassigned to Test for the focused Feature
    And the capacity transfer is recorded as a completion-focus swarm

  Scenario: Return Development capacity when the focused Feature needs it
    Given the focused Feature has work ready in Development
    When I simulate a working day with Stop starting, start finishing active
    Then Development uses its capacity for focused Feature work before swarming Test

  Scenario: Release the next Feature only after the current one is complete
    Given Feature 001 is the finishing focus
    And every Feature 001 PBI and feedback Bug has reached Done
    When I simulate the next working day
    Then Feature 001 is recorded as complete
    And Feature 002 becomes the finishing focus
    And Feature 002 work may be admitted from Backlog into Development

  Scenario: Respect explicit WIP limits while focusing on completion
    Given Stop starting, start finishing is active
    And Development, Integration, and Test each have an explicit WIP limit
    When I simulate the workflow
    Then no focused Feature item enters a stage above that stage's WIP limit
    And work blocked by a full downstream WIP limit remains visibly upstream

  Scenario: Leave a workflow without Features unchanged
    Given a backlog containing no Features
    When I activate Stop starting, start finishing
    Then regular backlog admission and capacity behavior continue unchanged
    And no finishing focus is shown

  Scenario: Expose the current finishing focus in the simulation readouts
    Given Stop starting, start finishing is active for a feature-backed backlog
    When I inspect a simulated day
    Then the CFD day inspector identifies the current finishing focus
    And the daily log identifies the focused Feature and any completion-focus swarm
