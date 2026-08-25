# slop-detector

The repo contains code demonstrating how to use the [Pangram](https://www.pangram.com) API to do AI-detection checks against webpages

I used this to analyze my own website at [zeke.sikelianos.com](https://zeke.sikelianos.com) to see which pages were AI-generated and which were written by a human (me).

See [zeke.sikelianos.com/slop-detection](https://zeke.sikelianos.com/slop-detection) for the writeup.

Per-page results live in [`results/pages`](./results/pages), and the site links to them from the slop indicator on each page. A [daily workflow](./.github/workflows/scan.yml) re-checks only the pages whose prose changed, since every Pangram call costs money.

See [AGENTS.md](./AGENTS.md) for technical details.

![Pangram developer dashboard showing usage and spend](./assets/pangram-dashboard.jpg)

