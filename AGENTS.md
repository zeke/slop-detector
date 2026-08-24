# AGENTS.md

Technical notes for agents working on this repo. Update this file whenever
meaningful structure, build, or behavior changes.

## What this is

A CLI that crawls pages on https://zeke.sikelianos.com (or whatever
`SITE_URL` is set to) and runs them through the [Pangram](https://pangram.com)
AI-detection API, to see which pages get flagged as AI-generated/AI-assisted
and why.

## Stack

- Node.js >= 18 (uses built-in `fetch`), ES modules (`"type": "module"`)
- `cheerio` for HTML parsing/extraction
- `dotenv` for loading `.env`
- No build step, no test suite yet, no linter configured

## Structure

- `bin/slop-detector.js` — CLI entrypoint, command dispatch (`urls`, `check`, `scan`, `backfill`, `report`)
- `src/sitemap.js` — fetches and parses `sitemap.xml`, filters it to top-level pages, derives paths and slugs
- `src/extract.js` — fetches a page's HTML, extracts prose text (strips nav/header/code/etc), hashes it
- `src/pangram.js` — thin client for the Pangram REST API (single `predict()`, bulk job flow, plagiarism check)
- `src/report.js` — turns Pangram results into per-page records, per-page markdown, and the site table
- `src/results.js` — reads/writes `results/`, builds `latest.json`, owns the public `dataUrl()` link format
- `.github/workflows/scan.yml` — daily incremental scan that commits changed results

## Results layout

```
results/
  pages/<slug>.json   one record per page: metadata, textHash, fractions, every scored window
  pages/<slug>.md     human-readable version of the same, in document order
  latest.json         rollup consumed by the website
  runs/<stamp>.json   archive of each run that actually called Pangram
```

`results/pages/<slug>.md` is the permalink the website's slop indicator links to,
so don't move or rename it without updating `dataUrl()` in `src/results.js` and
the site's `data/slop.json` consumers.

Records backfilled from the pre-2026-08-24 whole-site run have
`windowsComplete: false`: those runs only saved the flagged passages, so their
markdown can't show the human ones until the page is rescanned.

## Scope: top-level pages only

`fetchPageUrls()` keeps sitemap URLs matching `/<slug>` plus `/<slug>/index`
(pages whose source file is `index.html` get an href ending in `/index` on the
site). Nested pages like `/dial-a-repo/transcript` are supporting material and
are not worth Pangram credits. `/404/index` is excluded explicitly.

## Incremental scanning

`scan` extracts every top-level page (free), sha256-hashes the extracted prose,
and only sends pages to Pangram when the hash differs from the saved
`textHash`, the saved model differs, or the previous check failed. `--force`
rescans everything. `--max-words N` (default 20,000) aborts the run rather than
spending on an unexpectedly large diff, e.g. after a layout change.

The website renders its slop indicator inside `.page__content`, which would
change every page's hash on every run, and /slop-detection renders a table of
every page's score. `src/extract.js` strips `.slop-indicator` and anything
marked `[data-slop-ignore]` for exactly that reason. Keep those selectors in
sync with the site's markup.

## How extraction works

Pages on the site are rendered as `<article><div class="page__content">`
with `<h1 class="page__title">` and `<h2 class="page__description">` inside
a `<header>`. `extract.js` strips `header`, `script`, `style`, `pre`, `code`,
`iframe`, `svg`, `nav`, `.slop-indicator`, and `[data-slop-ignore]` from `.page__content` before taking `.text()`, so
only prose is sent to Pangram (not code blocks, nav chrome, etc). Pages under
50 words are skipped as too short to reliably classify.

If the site's markup changes (e.g. renamed classes), update the selectors in
`src/extract.js`.

## Pangram API notes

- Base URL for text/bulk detection: `https://text.external-api.pangram.com`
- Base URL for plagiarism: `https://plagiarism.api.pangram.com`
- Auth: `x-api-key` header, read from `PANGRAM_API_KEY`
- Text detection is async: `POST /task` returns a `task_id`, poll
  `GET /task/{task_id}` until `stage` is `STAGE_SUCCESS`/`STAGE_FAILED`
- Bulk detection: `POST /bulk` with `{ items: [{ id, text }] }`, poll
  `GET /bulk/{bulk_id}` until `status` is terminal, then page through
  `GET /bulk/{bulk_id}/results`
- `scan` uses the bulk flow (one job per run) since it's much
  faster than one task per page; `check` uses the single-task flow
- Model is hardcoded to `default` (Pangram 3) in `bin/slop-detector.js`. Pangram 3
  bills $0.05 per 1,000 words; Pangram 4 bills $0.05 per 100 words, 10x the cost
  for no benefit on this content. Call `GET /models` if that ever needs to change
  (availability varies by account entitlement)
- A `402 Payment Required` response means the Pangram account is out of
  credits, not a bug in this code
- Full API docs: https://docs.pangram.com

## Gotchas

- `SITE_URL` defaults to `https://zeke.sikelianos.com` but can point at a
  staging deploy for testing.
- Results are committed to the repo as a historical record. A full-site rescan
  (~82k words across ~51 pages) costs about $5-6, so avoid `--force`.
- The website at zeke.sikelianos.com reads `results/latest.json` on a schedule
  and commits it as `data/slop.json`, which triggers a deploy. Changing the shape
  of `latest.json` breaks that sync; see `script/sync-slop` in the website repo.
- The daily scan needs `PANGRAM_API_KEY` as an Actions secret in this repo.
- Pangram has no documented endpoint for checking remaining account credit
  balance; check https://www.pangram.com/plan manually before a big `scan`.
