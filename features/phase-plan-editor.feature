Feature: Configure a multi-phase intervention plan in the GUI

  A reader can build a simulation timeline directly in the cockpit by selecting
  an intervention profile and duration for each phase. The plan is contiguous:
  its first phase starts on day 0, each later phase starts on the next working
  day, and the simulation stops when the final phase ends.

  Phase changes take effect at the beginning of their first day. They change
  future admissions, activation, capacity, and movement decisions without
  resetting items that are already present on the simulated Kanban board.

  Scenario: Build a Baseline then WIP Limits plan
    Given I am editing the phase plan
    When I add a Baseline phase lasting 20 working days
    And I add a WIP Limits phase lasting 30 working days
    Then the phase plan shows Baseline on days 0 through 19
    And the phase plan shows WIP Limits on days 20 through 49
    And the simulation horizon is 50 working days

  Scenario: Extend an existing plan with Swarming
    Given a phase plan with Baseline for 20 working days and WIP Limits for 30 working days
    When I add a Swarming phase lasting 20 working days
    Then the new phase starts on day 50 and ends on day 69
    And the simulation horizon becomes 70 working days
    And the CFD shows phase boundaries on days 20 and 50

  Scenario: Apply the selected intervention only during its phase
    Given a phase plan with Baseline for 20 working days and WIP Limits for 30 working days
    When I run the simulation with seed 42
    Then Baseline settings apply on days 0 through 19
    And WIP limits apply on days 20 through 49
    And the simulation has no snapshots after day 49

  Scenario: Preserve work across a phase boundary
    Given a phase plan with a Baseline phase followed by WIP Limits
    And work is present in Development when the WIP Limits phase begins
    When I inspect the first day of the WIP Limits phase
    Then the existing work remains represented in Development or downstream
    And only later admissions are constrained by the new WIP limits

  Scenario: Reorder a phase plan before running it
    Given a phase plan with Baseline for 20 working days and WIP Limits for 30 working days
    When I move WIP Limits before Baseline
    Then WIP Limits covers days 0 through 29
    And Baseline covers days 30 through 49
    And the simulation horizon remains 50 working days

  Scenario: Remove a phase from the plan
    Given a phase plan with Baseline for 20 working days, WIP Limits for 30 working days, and Swarming for 20 working days
    When I remove the WIP Limits phase
    Then Baseline covers days 0 through 19
    And Swarming covers days 20 through 39
    And the simulation horizon becomes 40 working days

  Scenario: Reject an invalid phase duration
    Given I am editing the phase plan
    When I set a phase duration to 0 working days
    Then I am told that a phase duration must be a positive whole number
    And the saved phase plan remains unchanged

  Scenario: Save and reload a GUI-built phase plan
    Given a phase plan with Baseline for 20 working days and WIP Limits for 30 working days
    When I save the simulation as a project file
    And I load that project file
    Then the phase plan retains the same intervention order and durations
    And the loaded project has a 50-working-day simulation horizon
