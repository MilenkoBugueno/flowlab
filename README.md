# FlowLab

FlowLab is a browser-based product-flow simulation lab. It uses seeded
scenarios and cumulative flow diagrams (CFDs) to make queues, bottlenecks,
swarming, and WIP limits understandable.

## Shareable web deployment

The repository includes a GitHub Pages workflow. In GitHub, set **Settings →
Pages → Build and deployment → Source** to **GitHub Actions**. Every push to
`main` then publishes FlowLab at
`https://milenkobugueno.github.io/flowlab/`.

## Run the simulator locally

```sh
npm install
npm run dev
```

## Verify simulator behavior

```sh
npm test
```

The executable product behavior is expressed in `features/*.feature`. The
Cucumber steps exercise the simulation core directly; React and D3 render its
explicit daily snapshots and metrics.

The simulator includes Baseline, Start Finishing - Stop Starting, WIP Limits,
and WIP Limits + Start Finishing presets. It is a learning model, not a
calibrated prediction of a specific organization.

Load [`samples/baseline-to-wip.flowlab.json`](samples/baseline-to-wip.flowlab.json)
from the **Project file** panel to try a 10-Feature project that changes from
Baseline to WIP Limits on day 51.

In a project file, `config.featureBacklog` controls the initial Feature count.
Each `phases[].settings` object controls the runtime behavior for its day
range; phase settings take precedence over the same fields in `config`.
