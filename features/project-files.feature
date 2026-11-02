Feature: Project files with time-phased simulation settings

  A project file is a portable, versioned description of one FlowLab
  simulation. It holds the initial model once and a contiguous timeline of
  settings phases. Loading a project file must reproduce the same simulation
  for the same seed without requiring colleagues to re-enter controls.

  A phase starts at the beginning of its start day. It changes only future
  admissions, activation, capacity, and movement decisions; it never resets,
  deletes, or rewrites work that already exists in the simulated Kanban board.

  Scenario: Load a project with an initial feature backlog and two named phases
    Given a project file with 10 initial Features and seed 42
    And a Baseline phase from day 0 through day 50
    And a WIP Limits phase from day 51 through day 120
    When I load the project file
    Then the simulation horizon is 121 working days
    And exactly 10 Features are created before day 0
    And Baseline settings apply on days 0 through 50
    And Development, Integration, and Test WIP limits apply from day 51 through day 120

  Scenario: Apply a new phase before the start-of-day simulation decisions
    Given a loaded project with a Baseline phase through day 50
    And a WIP Limits phase beginning on day 51
    When I simulate day 51
    Then day 51 admissions and stage movements respect the WIP limits
    And work already above a newly introduced WIP limit is retained
    And no new item enters a full WIP-limited stage until a slot is free

  Scenario: Remove WIP limits in a later Baseline phase
    Given a loaded project with WIP Limits through day 50
    And a Baseline phase beginning on day 51
    When I simulate day 51
    Then stage WIP limits no longer restrict admissions from day 51
    And all existing work remains in its simulated stage with its existing progress

  Scenario: Combine a time-phased WIP policy with finishing focus
    Given a project file with feature-backed initial work
    And a WIP Limits phase from day 0 through day 50
    And a WIP Limits plus Start Finishing phase from day 51 through day 120
    When I load and simulate the project with seed 42
    Then WIP limits remain active in the second phase
    And the oldest unfinished Feature becomes the finishing focus on day 51
    And later Features are not admitted while that Feature remains unfinished

  Scenario: Persist resolved settings instead of only the currently displayed controls
    Given I have configured a simulation with a custom workflow, rates, initial Features, and time-phased settings
    When I save it as a project file
    And a colleague loads that project file
    Then the colleague sees the saved workflow, initial backlog, horizon, seed, and phase timeline
    And the same project file and seed produce identical daily snapshots and item histories

  Scenario: Show the active phase in the simulation cockpit
    Given I have loaded a project with more than one settings phase
    When I inspect day 50 and day 51 in the CFD or Kanban view
    Then the readout identifies the Baseline phase on day 50
    And the readout identifies the WIP Limits phase on day 51
    And the project timeline makes the phase boundary visible

  Scenario: Reject overlapping or incomplete phase timelines
    Given I am loading a project file for a 121-day simulation
    When two settings phases overlap on day 51
    Then I am told that project phases cannot overlap
    And the current simulation remains unchanged
    When no phase covers day 51
    Then I am told that project phases must cover every simulation day exactly once
    And the current simulation remains unchanged

  Scenario: Reject settings that are only valid before day 0 in a later phase
    Given I am loading a project file with an initial feature count of 10
    When a phase beginning on day 51 attempts to change the initial feature count
    Then I am told that initial backlog, workflow, horizon, and seed settings belong to the project header
    And the current simulation remains unchanged

  Scenario: Reject an unsupported project-file version without losing the current model
    Given I have an open simulation
    When I load a project file with an unsupported format version
    Then I am told that the project-file version is not supported
    And the open simulation remains unchanged
