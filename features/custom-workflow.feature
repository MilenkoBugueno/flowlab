Feature: Customizable workflow

  FlowLab lets a reader model the workflow their team actually uses instead of
  requiring the default Backlog, Development, Test, and Done states.
  A workflow is an ordered, linear set of states: work enters the first state,
  moves only to the next state, and leaves from the final state.

  Scenario: Rename the default workflow states
    Given a workflow with the states "Ready", "Build", "Peer review", "Release", and "Done"
    When I simulate 120 working days with seed 42
    Then the CFD displays the configured workflow state names
    And the daily movement log displays the configured state-to-state movements
    And work moves from Ready to Build to Peer review to Release to Done

  Scenario: Add a stage to the workflow
    Given a workflow with the states "Ready", "Discovery", "Development", "Review", "Test", and "Done"
    When I simulate 120 working days with seed 42
    Then the CFD includes a Discovery band
    And the daily movement log includes Ready to Discovery and Discovery to Development movements
    And work cannot move from Ready directly to Development

  Scenario: Reorder an intermediate workflow stage
    Given a workflow with the states "Ready", "Development", "Test", "Review", and "Done"
    When I simulate 120 working days with seed 42
    Then work moves from Development to Test before it moves to Review
    And the daily movement log does not include Development to Review movements

  Scenario: Reject an invalid workflow
    Given I am editing the workflow
    When I save a workflow with fewer than two states
    Then I am told that a workflow needs an entry and an exit state
    And the current workflow remains unchanged

  Scenario: Preserve a workflow's behavior for a reproducible simulation
    Given a workflow with the states "Ready", "Development", "Review", "Test", and "Done"
    When I simulate the workflow twice with seed 42
    Then both simulations have identical daily snapshots
    And both simulations have identical daily movement logs
