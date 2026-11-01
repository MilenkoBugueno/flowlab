Feature: Daily simulation movement log

  A daily log makes the flow behind a simulation inspectable. It records the
  aggregate item movements for every simulated working day, so that a reader
  can see how work entered, advanced through, and left the workflow.

  Scenario: Inspect the daily movements for one reproducible simulation
    Given the standard FlowLab baseline scenario
    When I simulate 120 working days with seed 42
    Then the daily log contains one entry for each simulated working day
    And each daily entry identifies its simulation day and seed
    And each daily entry lists the number of items moved between each pair of states
    And the initial backlog is not recorded as an External arrival
    And movements through the workflow are recorded as Backlog to Development, Development to Integration, and Integration to Test
    And completed work is recorded as Test to Done
    And movements that do not occur on a day are shown with zero counts

  Scenario: Daily movements reconcile with the simulation state
    Given the standard FlowLab baseline scenario
    When I simulate 120 working days with seed 42
    Then the initial backlog is not recorded as an External arrival
    And the sum of all daily Test to Done movements equals the number of completed items
    And the daily log movements reproduce the change in each state between consecutive daily snapshots
