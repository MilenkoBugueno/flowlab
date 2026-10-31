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
    And movements into the workflow are recorded as External to Ready
    And movements through the workflow are recorded as Ready to Development, Development to Review, and Review to Test
    And completed work is recorded as Test to Done
    And a daily entry with no movements is still shown with zero counts

  Scenario: Daily movements reconcile with the simulation state
    Given the standard FlowLab baseline scenario
    When I simulate 120 working days with seed 42
    Then the sum of all daily External to Ready movements equals the number of arrived items
    And the sum of all daily Test to Done movements equals the number of completed items
    And the daily log movements reproduce the change in each state between consecutive daily snapshots
