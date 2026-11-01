Feature: Custom simulation capacity and intervention settings

  FlowLab lets a reader tune the operating assumptions for the workflow they
  are modeling. Daily processing rates belong to active workflow stages, while
  incidents and swarms are explicit, editable interventions.

  Scenario: Configure the average backlog push rate
    Given I am editing the backlog push rate
    When I save an average backlog push rate of 1.6 items per day
    And I run the simulation with seed 42
    Then the simulation uses an average backlog push rate of 1.6 items per day
    And the same seed and backlog push rate produce identical daily snapshots

  Scenario: Reject an invalid backlog push rate
    Given I am editing the backlog push rate
    When I save an average backlog push rate of -0.1 items per day
    Then I am told that the backlog push rate must be zero or greater
    And the current backlog push rate remains unchanged

  Scenario: Edit the daily processing rate for every active stage
    Given a workflow with the states "Ready", "Discovery", "Development", "Review", "Test", and "Done"
    When I open the capacity allocation controls
    Then I can set a daily processing rate for Discovery, Development, Review, and Test
    And I cannot set a daily processing rate for Ready or Done

  Scenario: Save daily processing rates for a custom workflow
    Given a workflow with the states "Ready", "Discovery", "Development", "Review", "Test", and "Done"
    When I set the daily processing rates to 0.7 for Discovery, 1.2 for Development, 0.8 for Review, and 1.1 for Test
    And I run the simulation with seed 42
    Then the simulation uses those daily processing rates for the matching stages
    And the same seed and capacity allocation produce identical daily snapshots

  Scenario: Reject an invalid daily processing rate
    Given I am editing the capacity allocation controls
    When I save a daily processing rate of 0 for Test
    Then I am told that a daily processing rate must be greater than zero
    And the current capacity allocation remains unchanged

  Scenario: Configure a capacity incident
    Given I am editing the intervention controls
    When I set an incident in Test from day 24 through day 36 with a daily processing rate of 0.4
    And I run the simulation with seed 42
    Then the simulation applies the configured incident only to Test on days 24 through 36
    And Test uses a daily processing rate of 0.4 while the incident is active

  Scenario: Configure a swarm intervention
    Given I am editing the intervention controls
    When I set a swarm from Development to Test starting on day 45 for 10 days
    And I set the swarm capacity shift to 0.5 and the first-day effectiveness to 0.75
    And I run the simulation with seed 42
    Then the simulation temporarily shifts 0.5 daily capacity from Development to Test
    And Test receives 0.375 daily capacity from the swarm on its first day
    And the swarm stops after 10 days

  Scenario: Reject an invalid swarm configuration
    Given I am editing the intervention controls
    When I save a swarm that starts and ends in the same stage
    Then I am told that a swarm needs different source and target stages
    And the current intervention settings remain unchanged
