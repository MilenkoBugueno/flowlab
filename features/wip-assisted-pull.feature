Feature: WIP-limited pull with downstream assistance

  WIP limits make work pull-based: an item may enter a limited stage only when
  that stage has a free slot. When a WIP-limited stage has unused daily
  processing capacity after serving its own work, it can help the next active
  stage at a configurable effectiveness.

  Scenario: Pull work only when the limited stage has a free slot
    Given a workflow with a Development WIP limit of 2
    And Development already contains 2 items
    When another item is ready to enter Development
    Then the item remains in Backlog
    And the item is pulled into Development only after a Development slot becomes free

  Scenario: Keep constrained work visibly upstream
    Given a workflow with Development and Test WIP limits
    And Test has reached its WIP limit
    When Development completes an item that is ready for Test
    Then the item remains in Development until Test has a free slot
    And no item enters Test above its WIP limit

  Scenario: Use unused WIP-limited stage capacity to help the next stage
    Given Development has a WIP limit and unused daily processing capacity
    And Test has work waiting to be processed
    When I simulate a working day with the default WIP assistance effectiveness
    Then Development serves its own work before helping Test
    And the unused Development capacity is applied to Test at 0.75 effectiveness
    And the assistance only helps the next active stage, Test

  Scenario: Do not help downstream when the WIP-limited stage needs its own capacity
    Given Development has a WIP limit and enough work to use all of its daily processing capacity
    And Test has work waiting to be processed
    When I simulate a working day with the default WIP assistance effectiveness
    Then Development does not provide capacity assistance to Test

  Scenario: Configure WIP assistance effectiveness
    Given I am editing the WIP limit settings
    When I set the WIP assistance effectiveness to 0.5
    And Development has 0.4 unused daily processing capacity
    And Test has work waiting to be processed
    And I simulate a working day with a WIP assistance effectiveness of 0.5
    Then Test receives 0.2 daily processing capacity from Development

  Scenario: Reject an invalid WIP assistance effectiveness
    Given I am editing the WIP limit settings
    When I save a WIP assistance effectiveness of 1.1
    Then I am told that WIP assistance effectiveness must be between zero and one
    And the current WIP assistance settings remain unchanged
