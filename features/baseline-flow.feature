Feature: Review bottleneck is visible in the CFD

  Scenario: A temporary review-capacity incident creates a queue
    Given the standard FlowLab baseline scenario
    When I simulate 120 working days with seed 42
    Then the Code Review CFD band widens during the incident
    And every arrived item is either completed or active in the workflow

  Scenario: A seeded scenario is reproducible
    Given the standard FlowLab baseline scenario
    When I simulate the scenario twice with seed 42
    Then both simulations have identical daily snapshots
