Feature: WIP-limited pull with idle capacity

  WIP limits make work pull-based: an item may enter a limited stage only when
  that stage has a free slot. They do not reassign capacity between stages.
  When a WIP-limited stage has unused daily processing capacity after serving
  its own work, that capacity remains idle unless Swarming is active.

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
    Then the item waits in Integration until Test has a free slot
    And no item enters Test above its WIP limit

  Scenario: Keep unused WIP-limited stage capacity idle
    Given Development has a WIP limit and unused daily processing capacity
    And Test has work waiting to be processed
    When I simulate the WIP-limited workflow
    Then Development serves its own work before becoming idle
    And no capacity is transferred from Development to Test
    And the unused Development capacity remains idle
