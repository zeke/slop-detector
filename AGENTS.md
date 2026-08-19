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

- `bin/slop-detector.js` — CLI entrypoint, command dispatch (`urls`, `check`, `scan`, `report`)
- `src/sitemap.js` — fetches and parses `sitemap.xml` into a URL list
- `src/extract.js` — fetches a page's HTML and extracts prose text (strips nav/header/code/etc)
- `src/pangram.js` — thin client for the Pangram REST API (single `predict()`, bulk job flow, plagiarism check)
- `src/report.js` — merges Pangram results with page metadata into sorted rows + a markdown report
- `results/` — gitignored output directory for scan results (JSON + markdown per run)

## How extraction works

Pages on the site are rendered as `<article><div class="page__content">`
with `<h1 class="page__title">` and `<h2 class="page__description">` inside
a `<header>`. `extract.js` strips `header`, `script`, `style`, `pre`, `code`,
`iframe`, `svg`, and `nav` from `.page__content` before taking `.text()`, so
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
- `scan` uses the bulk flow (one job for the whole site) since it's much
  faster than one task per page; `check` uses the single-task flow
- Model selector is hardcoded to `"pangram-4"` in `src/pangram.js`; call
  `GET /models` if that ever needs to change (varies by account entitlement)
- A `402 Payment Required` response means the Pangram account is out of
  credits, not a bug in this code
- Full API docs: https://docs.pangram.com

## Gotchas

- `SITE_URL` defaults to `https://zeke.sikelianos.com` but can point at a
  staging deploy for testing.
- `scan` writes timestamped files to `results/`, which is gitignored. Commit
  specific reports manually if you want to keep one around.
