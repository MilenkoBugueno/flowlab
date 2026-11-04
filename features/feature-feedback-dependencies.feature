Feature: Feature decomposition, test gating, and delayed-feedback bugs

  A feature is a parent work item that starts as a variable number of PBIs.
  PBIs belonging to the same feature may be developed independently, but none
  may enter Test until every PBI in that feature has completed Development.
  Testing a PBI creates feedback work: in the first version, one Bug is
  created for each PBI that completes Test. A longer delay between development
  and testing makes that Bug more expensive to fix.

  Scenario: Configure a feature-backed initial backlog
    Given I am editing the feature-backed initial backlog
    When I set the initial feature count to 20
    And I set the PBIs per feature to a minimum of 5 and a maximum of 10
    Then the next simulation seeds 20 features in Backlog
    And every seeded feature contains between 5 and 10 PBIs
    And every seeded PBI has a feature ID and feature title
    And the same seed produces the same features, PBI counts, IDs, and titles

  Scenario: Reject invalid feature decomposition settings
    Given I am editing the feature-backed initial backlog
    When I set the initial feature count to -1
    Then I am told that the initial feature count must be a non-negative whole number
    And the feature-backed initial backlog settings remain unchanged
    When I set the minimum PBIs per feature to 8 and the maximum to 5
    Then I am told that the maximum PBIs per feature must be at least the minimum
    And the feature-backed initial backlog settings remain unchanged

  Scenario: A feature's PBIs cannot enter Test until the entire feature is developed
    Given a feature with 3 PBIs in Development
    And 2 PBIs have completed Development
    When I simulate the next working day
    Then the 2 developed PBIs wait for their feature's test gate
    And no PBI from that feature enters Test
    When the third PBI completes Development
    Then all 3 PBIs become eligible to enter Test according to Test WIP and concurrency

  Scenario: Test admission remains subject to normal stage policies after the feature gate opens
    Given a feature with 3 developed PBIs whose test gate is open
    And Test has an explicit WIP limit of 2 items
    When work is pulled into Test
    Then 2 PBIs from that feature enter Test
    And 1 PBI remains waiting for a free Test WIP slot
    And the Kanban board identifies the feature on all three PBIs

  Scenario: WIP limits pull individually developed PBIs into Test
    Given a WIP-limited Feature with 3 PBIs and staggered Development completion
    When a developed PBI can be pulled into Test
    Then it enters Test without waiting for the remaining PBI to finish Development
    And Test WIP still limits how many ready PBIs can enter

  Scenario: Testing a PBI creates one traceable feedback bug
    Given a tested PBI from feature "Feature 001"
    And the bug generation ratio is one bug per tested PBI
    When the PBI completes Test on day 40
    Then exactly one Bug is created for that PBI on day 40
    And the Bug has its own unique ID and title
    And the Bug retains the originating PBI ID and feature ID
    And the Bug enters Backlog inactive with 0 percent progress
    And completing the PBI again does not create another Bug

  Scenario: Feedback delay increases bug-fix effort
    Given a PBI was completed in Development on day 20
    And that PBI completes Test on day 40
    And the base Bug effort is 1.0
    And the feedback-delay effort factor is 0.1 per working day
    When its feedback Bug is created
    Then the Bug receives 3.0 units of fix effort
    And the delay is recorded as 20 working days

  Scenario: Prompt testing does not add a feedback-delay penalty
    Given a PBI was completed in Development on day 20
    And that PBI completes Test on day 20
    And the base Bug effort is 1.0
    And the feedback-delay effort factor is 0.1 per working day
    When its feedback Bug is created
    Then the Bug receives 1.0 units of fix effort
    And the delay is recorded as 0 working days

  Scenario: Feature completion includes its generated feedback bugs
    Given a feature whose PBIs have completed Test and generated feedback Bugs
    When all of that feature's feedback Bugs reach Done
    Then the feature is shown as complete
    And the feature completion day is the latest completion day of its PBIs and Bugs
    And feature metrics count the feature once
