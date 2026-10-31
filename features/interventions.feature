Feature: Flow interventions expose their trade-offs

  Scenario: Swarming sends capacity to Code Review
    Given the baseline scenario with a scheduled Review swarm
    When I simulate 120 working days with seed 42
    Then the swarm runs after the review incident
    And Review queue-days are lower than in the baseline for the same seed

  Scenario: WIP limits keep Review work bounded and visible
    Given the baseline scenario with Development and Review WIP limits
    When I simulate 120 working days with seed 42
    Then Review WIP never exceeds 6 items
    And constrained work remains visible upstream
