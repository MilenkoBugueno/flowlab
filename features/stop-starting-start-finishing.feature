Feature: Swarming

  Swarming lets a stage lend capacity that it cannot use itself to an active
  bottleneck. It does not change backlog admission or restrict work to one
  Feature by itself.

  When Swarming is combined with backlog ranking, it selects the highest-ranked
  eligible work first and directs borrowed capacity to the highest-ranked active
  work. Lower-ranked work stays eligible when no higher-ranked item can move,
  so the flow does not drain unnecessarily.

  Scenario: Borrow spare Development capacity for an active Test bottleneck
    Given Swarming is active with spare Development capacity and active Test work
    When I simulate the Swarming workflow
    Then unused Development capacity is reassigned to Test
    And the transfer is recorded as a swarm without a Feature focus

  Scenario: Do not gate Feature admission when Swarming has no ranking
    Given a feature-backed backlog with WIP limits and Swarming but without backlog ranking
    When I simulate the Swarming workflow
    Then work from more than one Feature is admitted into Development
    And no Feature admission focus is shown

  Scenario: Keep capacity at its source while that stage has active work
    Given Swarming is active but Development has work of its own
    When I simulate the Swarming workflow
    Then Development does not lend capacity before its own work is complete

  Scenario: Prioritize the highest-ranked Feature with WIP limits, Swarming, and ranking
    Given WIP limits, Swarming, and backlog ranking are active for ranked Features
    When I simulate the ranked Swarming workflow
    Then Feature 001 is the current ranked focus
    And Feature 001 is admitted before lower-ranked work when it is eligible
    And lower-ranked work is admitted when Feature 001 has no Backlog work ready
    And spare capacity supports Feature 001 at the Test bottleneck
