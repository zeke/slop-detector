#!/usr/bin/env node
import 'dotenv/config'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

import { fetchSitemapUrls, fetchPageUrls } from '../src/sitemap.js'
import { extractPage } from '../src/extract.js'
import { predict, submitBulk, waitForBulk, getBulkResults, checkPlagiarism } from '../src/pangram.js'
import { buildRecord, toMarkdown } from '../src/report.js'
import { buildLatest, prunePageResults, readPageResults, sortByAi, writeLatest, writePageResult, RUNS_DIR } from '../src/results.js'

const SITE_URL = process.env.SITE_URL || 'https://zeke.sikelianos.com'

// Pangram 3 ("default") bills $0.05 per 1,000 words. Pangram 4 bills $0.05 per
// 100 words for no benefit on this content, so everything here uses Pangram 3.
const MODEL = 'default'

// A scan costing more than this many words needs an explicit --max-words bump,
// so a site-wide template change can't quietly burn the whole Pangram balance.
const DEFAULT_MAX_WORDS = 20000

const [, , command, ...args] = process.argv

try {
  switch (command) {
    case 'urls':
      await cmdUrls(args)
      break
    case 'check':
      await cmdCheck(args)
      break
    case 'scan':
      await cmdScan(args)
      break
    case 'backfill':
      await cmdBackfill(args)
      break
    case 'report':
      await cmdReport()
      break
    default:
      printUsage()
      process.exit(command ? 1 : 0)
  }
} catch (err) {
  console.error(`Error: ${err.message}`)
  process.exit(1)
}

function printUsage () {
  console.log(`Usage: slop-detector <command> [options]

Commands:
  urls [--all]            List the top-level page URLs that get scanned (--all: every sitemap URL)
  check <url>             Run a single-page Pangram AI-detection check, printing results
  scan [--force] [--max-words N] [--limit N]
                          Check every top-level page whose prose changed since the last scan,
                          and rewrite results/pages/, results/latest.json, results/runs/
  backfill <run.json>     Seed results/pages/ from an old whole-site run, using the live
                          site for content hashes so nothing is rescanned needlessly
  report                  Rebuild results/pages/*.md and results/latest.json from saved JSON

Environment:
  PANGRAM_API_KEY   required for check and scan
  SITE_URL          defaults to https://zeke.sikelianos.com`)
}

async function cmdUrls (args) {
  const urls = args.includes('--all') ? await fetchSitemapUrls(SITE_URL) : await fetchPageUrls(SITE_URL)
  for (const url of urls) console.log(url)
}

async function cmdCheck (args) {
  const url = args[0]
  if (!url) throw new Error('Usage: slop-detector check <url>')

  console.log(`Fetching ${url}...`)
  const page = await extractPage(url)
  console.log(`Extracted ${page.wordCount} words: "${page.title}"`)

  if (page.skipped) {
    console.log('Too short to check (fewer than 50 words). Skipping Pangram call.')
    return
  }

  console.log(`Checking with Pangram (${MODEL})...`)
  const result = await predict(page.text, { model: MODEL })

  console.log('')
  console.log(`Headline: ${result.headline}`)
  console.log(`AI: ${pct(result.fraction_ai)}  AI-Assisted: ${pct(result.fraction_ai_assisted)}  Human: ${pct(result.fraction_human)}`)

  const offenders = result.windows.filter(window => window.label !== 'Human Written')
  if (offenders.length) {
    console.log('')
    console.log('Offending passages:')
    for (const window of offenders) {
      console.log(`  [${window.label}, score ${window.ai_assistance_score.toFixed(2)}, ${window.confidence} confidence] ${window.text}`)
    }
  }

  const plagiarism = await checkPlagiarism(page.text)
  if (plagiarism.plagiarism_detected) {
    console.log('')
    console.log(`Plagiarism detected: ${plagiarism.percent_plagiarized}% of sentences matched online sources.`)
    for (const match of plagiarism.plagiarized_content) {
      console.log(`  ${match.source_url} (similarity ${match.similarity_score})`)
    }
  }
}

async function cmdScan (args) {
  const force = args.includes('--force')
  const limit = parseIntFlag(args, '--limit')
  const maxWords = parseIntFlag(args, '--max-words') ?? DEFAULT_MAX_WORDS

  const pages = await extractAll({ limit })
  const previous = await readPageResults()

  const checkable = pages.filter(page => !page.skipped)
  const stale = force ? checkable : checkable.filter(page => needsCheck(page, previous.get(page.path)))
  const staleWords = stale.reduce((sum, page) => sum + page.wordCount, 0)

  console.log('')
  console.log(`${checkable.length} pages checkable, ${stale.length} changed since the last scan (${staleWords} words).`)

  if (staleWords > maxWords) {
    throw new Error(`Scanning ${staleWords} words exceeds the ${maxWords}-word safety cap. Re-run with --max-words ${staleWords} if that spend is intended.`)
  }

  const records = new Map()
  for (const page of pages) {
    const prior = previous.get(page.path)
    if (prior) records.set(page.path, { ...prior, title: page.title, url: page.url })
  }

  if (stale.length) {
    for (const record of await checkPages(stale)) records.set(record.path, record)
  } else {
    console.log('Nothing to check. Refreshing saved results.')
  }

  const current = pages.map(page => records.get(page.path)).filter(Boolean)
  for (const record of current) await writePageResult(record)

  const removed = await prunePageResults(new Set(pages.map(page => page.slug)))
  for (const filename of removed) console.log(`Removed stale result ${filename}`)

  await writeLatest(buildLatest(current, { siteUrl: SITE_URL, model: MODEL }))

  if (stale.length) {
    await mkdir(RUNS_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const runPath = path.join(RUNS_DIR, `${stamp}.json`)
    const checkedRecords = stale.map(page => records.get(page.path)).filter(Boolean)
    await writeFile(runPath, `${JSON.stringify({ siteUrl: SITE_URL, model: MODEL, generatedAt: new Date().toISOString(), records: checkedRecords }, null, 2)}\n`)
    console.log(`Saved ${runPath}`)
  }

  console.log('')
  console.log(toMarkdown(sortByAi(current), { siteUrl: SITE_URL }))
}

async function cmdBackfill (args) {
  const file = args[0]
  if (!file) throw new Error('Usage: slop-detector backfill <run.json>')

  const data = JSON.parse(await readFile(file, 'utf8'))
  const rowsByUrl = new Map((data.rows || data.records || []).map(row => [row.url, row]))

  const pages = await extractAll({})
  const records = []

  for (const page of pages) {
    const row = rowsByUrl.get(page.url)
    if (!row) {
      console.log(`  no prior result for ${page.url}, leave it for the next scan`)
      continue
    }

    records.push({
      path: page.path,
      slug: page.slug,
      url: page.url,
      title: page.title || row.title,
      wordCount: page.wordCount,
      textHash: page.textHash,
      model: data.model || MODEL,
      checkedAt: data.generatedAt,
      stage: row.stage,
      error: row.error ?? null,
      headline: row.headline,
      fractionAi: row.fractionAi,
      fractionAiAssisted: row.fractionAiAssisted,
      fractionHuman: row.fractionHuman,
      // Old runs only kept the flagged passages, so these records can't show
      // the human ones until the page is rescanned.
      windowsComplete: false,
      windows: row.offendingWindows || []
    })
  }

  for (const record of records) await writePageResult(record)
  await prunePageResults(new Set(records.map(record => record.slug)))
  await writeLatest(buildLatest(records, { siteUrl: data.siteUrl || SITE_URL, model: data.model || MODEL }))

  console.log(`Backfilled ${records.length} pages from ${file}`)
}

async function cmdReport () {
  const records = [...(await readPageResults()).values()]
  if (!records.length) throw new Error('No saved results in results/pages')

  for (const record of records) await writePageResult(record)
  await writeLatest(buildLatest(records, { siteUrl: SITE_URL, model: MODEL }))

  console.log(toMarkdown(sortByAi(records), { siteUrl: SITE_URL }))
}

/** Fetch and extract every top-level page. Free: no Pangram calls involved. */
async function extractAll ({ limit }) {
  console.log(`Fetching sitemap from ${SITE_URL}...`)
  let urls = await fetchPageUrls(SITE_URL)
  if (limit) urls = urls.slice(0, limit)
  console.log(`Found ${urls.length} top-level pages.`)

  console.log('Extracting page content...')
  const pages = []
  for (const url of urls) {
    try {
      const page = await extractPage(url)
      pages.push(page)
      console.log(`  ${page.skipped ? 'skip' : 'ok  '} ${page.wordCount.toString().padStart(5)} words  ${url}`)
    } catch (err) {
      console.log(`  fail        -  ${url} (${err.message})`)
    }
  }

  return pages
}

function needsCheck (page, prior) {
  if (!prior) return true
  if (prior.stage !== 'STAGE_SUCCESS') return true
  if (prior.model !== MODEL) return true
  return prior.textHash !== page.textHash
}

/** Send pages to Pangram's bulk API and turn the results into per-page records. */
async function checkPages (pages) {
  console.log(`Submitting ${pages.length} pages to Pangram's bulk API using "${MODEL}"...`)

  const bulk = await submitBulk(pages.map(page => ({ id: page.url, text: page.text })), { model: MODEL })
  console.log(`Bulk job ${bulk.bulk_id} queued (${bulk.accepted_items.length} accepted, ${bulk.failed_items.length} failed).`)

  await waitForBulk(bulk.bulk_id, {
    onTick: status => console.log(`  ${status.status}: ${status.succeeded}/${status.total_items} succeeded, ${status.failed} failed`)
  })

  const results = await getBulkResults(bulk.bulk_id)
  const pageByUrl = new Map(pages.map(page => [page.url, page]))

  return results.items
    .filter(item => pageByUrl.has(item.id))
    .map(item => buildRecord(pageByUrl.get(item.id), item.result, {
      model: MODEL,
      stage: item.stage,
      error: item.error || null
    }))
}

function parseIntFlag (args, name) {
  const value = parseFlag(args, name)
  return value == null ? null : parseInt(value, 10)
}

function parseFlag (args, name) {
  const index = args.indexOf(name)
  if (index === -1) return null
  return args[index + 1]
}

function pct (value) {
  if (value == null) return '-'
  return `${Math.round(value * 100)}%`
}
