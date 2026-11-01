Feature: Operational concurrency and task-switching costs

  Teams have a practical concurrency limit even when an explicit WIP limit is
  not configured. The limit caps active work, not pull: excess pushed work
  waits inside the stage. Work beyond a stage's focus WIP creates
  task-switching loss.

  Scenario: Work at or below focus WIP uses full stage capacity
    Given Development has a daily capacity of 1.4 and a focus WIP of 2 items
    And Development has 2 active items
    When I simulate a working day
    Then Development uses its full daily capacity of 1.4
    And Development records no task-switching loss

  Scenario: Excess concurrent work reduces effective capacity at the configured loss ratio
    Given Development has a daily capacity of 1.4, a focus WIP of 2 items, and a task-switching loss ratio of 1.0
    And Development has 4 active items
    When I simulate a working day
    Then Development uses an effective daily capacity of 0.7
    And Development records 0.7 daily capacity as task-switching loss

  Scenario: A lower task-switching loss ratio retains more effective capacity
    Given Development has a daily capacity of 1.4, a focus WIP of 2 items, and a task-switching loss ratio of 0.5
    And Development has 4 active items
    When I simulate a working day
    Then Development uses an effective daily capacity of 1.05
    And Development records 0.35 daily capacity as task-switching loss

  Scenario: Operational concurrency does not block pull without an explicit WIP limit
    Given Development has a maximum concurrency of 16 items and no explicit Development WIP limit
    And 17 items are ready to enter Development
    When work is pulled into Development
    Then all 17 items enter Development
    And no more than 16 items are actively worked in Development
    And the seventeenth item waits inside Development until an active slot becomes free

  Scenario: Configure the operational concurrency maximum per stage
    Given I am editing the Development operating assumptions
    When I set Development maximum concurrency to 16 items
    And Development has no explicit WIP limit
    Then Development can actively work on up to 16 items
    And additional pushed items wait inside Development until an active slot becomes free

  Scenario: Configure focus WIP independently per stage
    Given I am editing the Development operating assumptions
    When I set Development focus WIP to 3 items
    Then Development uses full capacity with up to 3 active items
    And task-switching loss begins when Development has more than 3 active items

  Scenario: Explicit WIP limits remain stricter than operational concurrency
    Given Development has a maximum concurrency of 16 items
    And Development has an explicit WIP limit of 2 items
    When 2 items occupy Development
    Then no additional item enters Development

  Scenario: Configure operational WIP assumptions per stage
    Given I am editing the Development operating assumptions
    When I set focus WIP to 2, maximum concurrency to 16, and task-switching loss ratio to 0.5
    Then the simulation uses those Development operating assumptions
    And the CFD, metrics, and daily log expose the resulting concurrency and task-switching effects

  Scenario: Reject invalid operational concurrency settings
    Given I am editing the Development operating assumptions
    When I save a maximum concurrency lower than focus WIP
    Then I am told that maximum concurrency must be at least focus WIP
    And the current operating assumptions remain unchanged

  Scenario: Reject an invalid task-switching loss ratio
    Given I am editing the Development operating assumptions
    When I save a task-switching loss ratio greater than 1
    Then I am told that the task-switching loss ratio must be between zero and one
    And the current operating assumptions remain unchanged
