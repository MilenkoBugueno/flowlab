Feature: Test bottleneck constrains the flow

  Scenario: Lower Test capacity holds work upstream
    Given the standard FlowLab baseline scenario
    When I simulate 120 working days with seed 42
    Then Test has a lower daily processing rate than Development
    And the Test constraint holds work visibly upstream
    And every arrived item is either completed or active in the workflow

  Scenario: A seeded scenario is reproducible
    Given the standard FlowLab baseline scenario
    When I simulate the scenario twice with seed 42
    Then both simulations have identical daily snapshots
