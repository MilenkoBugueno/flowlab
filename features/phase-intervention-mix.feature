Feature: Combine interventions within a phase

  A phase can apply more than one flow intervention at the same time. Rather
  than choosing one mutually exclusive scenario profile, a reader composes the
  phase from independently enabled policies. The phase duration, workflow,
  processing rates, concurrency settings, and initial backlog remain global
  configuration unless they are separately changed.

  The available composable policies are:

  - WIP limits, using the configured limit for every applicable stage.
  - Swarming, which focuses admission and unused
    Development capacity on the oldest unfinished Feature.
  - Order backlog by ranking, which admits lower numeric Feature rankings
    first from Backlog.

  A policy becomes active at the start of its phase and is removed at the
  start of the next phase unless that next phase also enables it. Existing
  items are never reset, moved backward, or discarded at a phase boundary.

  Scenario: Compose WIP limits, Swarming, and backlog ranking in one phase
    Given I am editing the phase plan
    When I add a phase lasting 30 working days
    And I enable WIP limits for that phase
    And I enable Swarming for that phase
    And I enable Order backlog by ranking for that phase
    Then the phase lists WIP limits, Swarming, and Order backlog by ranking
    And its settings retain the configured WIP limits
    And its settings enable Swarming from the phase's first day
    And its settings enable backlog ranking

  Scenario: Apply all policies of a mixed phase together
    Given a phase with WIP limits, Swarming, and Order backlog by ranking
    And the Backlog contains ranked work for more than one unfinished Feature
    When I simulate the phase
    Then Development, Integration, and Test respect their configured WIP limits
    And only the current finishing Feature is admitted from Backlog
    And its lower-ranked Backlog work is selected before any other eligible work for that Feature
    And unused Development capacity may assist the focused Feature in Test

  Scenario: Use ranking with WIP limits without Swarming
    Given a phase with WIP limits and Order backlog by ranking
    And Swarming is disabled for that phase
    When Development has a free WIP slot
    Then the highest-ranked eligible Backlog item is pulled into Development
    And more than one Feature may have active work

  Scenario: Turn a policy off in the next phase without changing the others
    Given a 20-day phase with WIP limits, Swarming, and Order backlog by ranking
    And it is followed by a 20-day phase with WIP limits and Order backlog by ranking only
    When day 20 begins
    Then WIP limits remain active
    And Backlog remains ordered by ranking
    And Swarming no longer restricts admission
    And work already present in the workflow remains in its simulated stage

  Scenario: Re-edit a mixed phase without losing its other policies
    Given a phase with WIP limits and Order backlog by ranking
    When I enable Swarming for that phase
    Then WIP limits remain enabled for that phase
    And Order backlog by ranking remains enabled for that phase
    And the phase contains all three policies

  Scenario: Save and reload a mixed phase
    Given a phase with WIP limits, Swarming, and Order backlog by ranking
    When I save the simulation as a project file
    And I load that project file
    Then the loaded phase retains all enabled policies and its duration
    And the same project file and seed reproduce the same snapshots and item histories
