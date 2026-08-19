#!/usr/bin/env node
import 'dotenv/config'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

import { fetchSitemapUrls } from '../src/sitemap.js'
import { extractPage } from '../src/extract.js'
import { predict, submitBulk, waitForBulk, getBulkResults, checkPlagiarism } from '../src/pangram.js'
import { buildRows, toMarkdown } from '../src/report.js'

const SITE_URL = process.env.SITE_URL || 'https://zeke.sikelianos.com'

const [, , command, ...args] = process.argv

try {
  switch (command) {
    case 'urls':
      await cmdUrls()
      break
    case 'check':
      await cmdCheck(args[0])
      break
    case 'scan':
      await cmdScan(args)
      break
    case 'report':
      await cmdReport(args[0])
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
  urls                    List every URL from the site's sitemap.xml
  check <url>             Run a single-page Pangram AI-detection check
  scan [--limit N]        Extract and check every page on the site via Pangram's bulk API
  report <results.json>   Regenerate a markdown report from saved results

Environment:
  PANGRAM_API_KEY   required, your Pangram API key
  SITE_URL          defaults to https://zeke.sikelianos.com`)
}

async function cmdUrls () {
  const urls = await fetchSitemapUrls(SITE_URL)
  for (const url of urls) console.log(url)
}

async function cmdCheck (url) {
  if (!url) throw new Error('Usage: slop-detector check <url>')

  console.log(`Fetching ${url}...`)
  const page = await extractPage(url)
  console.log(`Extracted ${page.wordCount} words: "${page.title}"`)

  if (page.skipped) {
    console.log('Too short to check (fewer than 50 words). Skipping Pangram call.')
    return
  }

  console.log('Checking with Pangram...')
  const result = await predict(page.text)

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
  const limit = parseIntFlag(args, '--limit')

  console.log(`Fetching sitemap from ${SITE_URL}...`)
  let urls = await fetchSitemapUrls(SITE_URL)
  if (limit) urls = urls.slice(0, limit)
  console.log(`Found ${urls.length} URLs.`)

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

  const checkable = pages.filter(page => !page.skipped)
  console.log(`Submitting ${checkable.length} pages to Pangram's bulk API...`)

  const bulk = await submitBulk(checkable.map(page => ({ id: page.url, text: page.text })))
  console.log(`Bulk job ${bulk.bulk_id} queued (${bulk.accepted_items.length} accepted, ${bulk.failed_items.length} failed).`)

  await waitForBulk(bulk.bulk_id, {
    onTick: status => console.log(`  ${status.status}: ${status.succeeded}/${status.total_items} succeeded, ${status.failed} failed`)
  })

  const bulkResults = await getBulkResults(bulk.bulk_id)
  const rows = buildRows(pages, bulkResults)
  const markdown = toMarkdown(rows, { siteUrl: SITE_URL })

  const outDir = 'results'
  await mkdir(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const jsonPath = path.join(outDir, `${stamp}.json`)
  const mdPath = path.join(outDir, `${stamp}.md`)

  await writeFile(jsonPath, JSON.stringify({ siteUrl: SITE_URL, generatedAt: new Date().toISOString(), rows }, null, 2))
  await writeFile(mdPath, markdown)

  console.log('')
  console.log(markdown)
  console.log(`Saved ${jsonPath} and ${mdPath}`)
}

async function cmdReport (file) {
  if (!file) throw new Error('Usage: slop-detector report <results.json>')
  const data = JSON.parse(await readFile(file, 'utf8'))
  console.log(toMarkdown(data.rows, { siteUrl: data.siteUrl }))
}

function parseIntFlag (args, name) {
  const index = args.indexOf(name)
  if (index === -1) return null
  return parseInt(args[index + 1], 10)
}

function pct (value) {
  if (value == null) return '-'
  return `${Math.round(value * 100)}%`
}
