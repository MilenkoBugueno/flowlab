Feature: Flow interventions expose their trade-offs

  Scenario: Swarming sends capacity to Test
    Given the baseline scenario with a scheduled Test swarm
    When I simulate 120 working days with seed 42
    Then the swarm sends capacity from Development to Test
    And Test queue-days are lower than in the baseline for the same seed

  Scenario: WIP limits keep Integration and Test work bounded and visible
    Given the baseline scenario with Development, Integration, and Test WIP limits
    When I simulate 120 working days with seed 42
    Then Test WIP never exceeds 6 items
    And Integration WIP never exceeds 5 items
    And constrained work remains visible upstream
