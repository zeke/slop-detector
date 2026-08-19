# slop-detector

Runs [Pangram](https://www.pangram.com) AI-detection checks against pages on
[zeke.sikelianos.com](https://zeke.sikelianos.com), as a way to see whether
(and where) the site's AI-assisted writing gets flagged.

See [AGENTS.md](./AGENTS.md) for technical details.

## Setup

```bash
npm install
cp .env.example .env
# then fill in PANGRAM_API_KEY in .env
```

## Usage

```bash
# list every URL on the site (from sitemap.xml)
node bin/slop-detector.js urls

# check a single page
node bin/slop-detector.js check https://zeke.sikelianos.com/solitaire

# scan the whole site via Pangram's bulk API, save JSON + markdown to results/
node bin/slop-detector.js scan

# scan just the first N pages (useful for testing)
node bin/slop-detector.js scan --limit 5

# regenerate a markdown report from a saved results file
node bin/slop-detector.js report results/2026-08-18T00-00-00-000Z.json
```
