Feature: Mean CFD across multiple seeds

  FlowLab can aggregate multiple seeded simulations into a mean cumulative flow
  diagram. This makes the expected flow profile visible without treating one
  random run as representative.

  Scenario: Build a mean CFD from a chosen number of simulations
    Given the standard FlowLab baseline scenario
    When I choose 100 seeds for the mean CFD
    And I run the mean simulation
    Then FlowLab runs 100 simulations for the selected scenario
    And the CFD is labeled as the mean of 100 simulations
    And each CFD band shows the arithmetic mean number of items in its state for each working day
    And the mean CFD includes every working day in the simulation horizon

  Scenario: Change the number of seeds used for the mean CFD
    Given the standard FlowLab baseline scenario
    When I choose 25 seeds for the mean CFD
    And I run the mean simulation
    Then FlowLab runs 25 simulations for the selected scenario
    And the mean CFD is based on 25 distinct seeds

  Scenario: Reproduce a mean CFD with the same settings
    Given the standard FlowLab baseline scenario
    When I choose 100 seeds for the mean CFD
    And I run the mean simulation twice
    Then both mean CFDs have identical daily state values
    And both mean CFDs use the same set of seeds

  Scenario: Build a mean CFD for a custom workflow
    Given a workflow with the states "Ready", "Discovery", "Development", "Review", "Test", and "Done"
    When I choose 50 seeds for the mean CFD
    And I run the mean simulation
    Then the mean CFD displays every configured workflow state
    And the mean CFD includes a Discovery band

  Scenario: Compare an intervention mean against a fair baseline mean
    Given the baseline scenario with a scheduled Test capacity transfer
    When I choose 100 seeds for the mean CFD
    And I run the mean simulation
    Then the baseline comparison uses the same 100 seeds
    And each selected-scenario run and baseline run share the same demand stream for its seed
    And the displayed metric differences are calculated from the two mean results

  Scenario: Reject an invalid mean CFD seed count
    Given I am editing the mean CFD seed count
    When I save a seed count of 0
    Then I am told that the mean CFD seed count must be a positive whole number
    And the current mean CFD seed count remains unchanged
