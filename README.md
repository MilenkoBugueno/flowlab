# FlowLab

FlowLab is a transparent product-flow simulation lab. It uses seeded scenarios and cumulative flow diagrams (CFDs) to make queues, bottlenecks, swarming, and WIP limits understandable.

## Shareable web deployment

The repository includes a GitHub Pages workflow. In GitHub, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Every push to `main` then publishes FlowLab at `https://milenkobugueno.github.io/flowlab/`. You can also run **Deploy FlowLab to GitHub Pages** manually from the Actions tab.

## Run locally

```sh
npm install
npm run dev
```

## Verify behavior

```sh
npm test
```

The executable product behavior is expressed in `features/*.feature`. The Cucumber steps exercise the simulation core directly; React and D3 only render its explicit daily snapshots and metrics.

## Prototype boundaries

- Four fixed scenarios: Baseline, Start Finishing - Stop Starting, WIP Limits, and WIP Limits + Start Finishing.
- Same seed means same demand stream for fair comparisons.
- Test is the default bottleneck; finishing focus uses otherwise unused Development capacity to help Test without creating capacity.
- WIP limits hold work visibly upstream rather than hiding it.

This is a learning model, not a calibrated prediction of a specific organization.
