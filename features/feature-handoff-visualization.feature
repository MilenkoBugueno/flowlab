Feature: Visualize Feature handoff to the final working stage

  A Feature is handed over when every one of its PBIs has entered the final
  active workflow stage before Done. In the default workflow this stage is
  Test. The handoff is a Feature-level event: it is not delayed by feedback
  Bugs that are created later during testing.

  Scenario: Show when a Feature has been handed over to Test
    Given a seeded simulation with a Feature whose PBIs are ready for Test
    And Test admits the Feature's PBIs over more than one working day
    When the last PBI of that Feature first enters Test
    And I enable "Show Feature handoffs" in the CFD
    Then the CFD shows one Feature-handoff marker on that day
    And the marker identifies the handed-over Feature
    And no Feature-handoff marker is shown before every PBI of that Feature has entered Test
    And feedback Bugs do not delay or add another Feature-handoff marker

  Scenario: Group Feature handoffs that occur on the same day
    Given a seeded simulation where two Features are handed over to Test on the same day
    When I enable "Show Feature handoffs" in the CFD
    Then the CFD shows one handoff marker on their shared handoff day
    And the marker identifies that 2 Features were handed over

  Scenario: Keep Feature-handoff markers optional and specific to a single run
    Given a seeded simulation with at least one Feature handoff
    When "Show Feature handoffs" is disabled
    Then the CFD does not show Feature-handoff markers
    When I view a mean CFD across multiple seeds
    Then the Feature-handoff visualization is unavailable because there is no single item history
