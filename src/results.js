import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { toPageMarkdown } from './report.js'

export const RESULTS_DIR = 'results'
export const PAGES_DIR = path.join(RESULTS_DIR, 'pages')
export const RUNS_DIR = path.join(RESULTS_DIR, 'runs')
export const LATEST_PATH = path.join(RESULTS_DIR, 'latest.json')

const REPO_URL = 'https://github.com/zeke/slop-detector'

/** Public link to a page's detailed results, shown as "see the analysis" on the site. */
export function dataUrl (slug) {
  return `${REPO_URL}/blob/main/results/pages/${slug}.md`
}

/** Every saved per-page result, keyed by site path (e.g. "/solitaire"). */
export async function readPageResults () {
  const byPath = new Map()

  let filenames = []
  try {
    filenames = await readdir(PAGES_DIR)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return byPath
  }

  for (const filename of filenames) {
    if (!filename.endsWith('.json')) continue
    const record = JSON.parse(await readFile(path.join(PAGES_DIR, filename), 'utf8'))
    byPath.set(record.path, record)
  }

  return byPath
}

export async function writePageResult (record) {
  await mkdir(PAGES_DIR, { recursive: true })
  await writeFile(path.join(PAGES_DIR, `${record.slug}.json`), `${JSON.stringify(record, null, 2)}\n`)
  await writeFile(path.join(PAGES_DIR, `${record.slug}.md`), toPageMarkdown(record))
}

/** Delete per-page results for pages that are no longer in the sitemap. */
export async function prunePageResults (keepSlugs) {
  const removed = []

  let filenames = []
  try {
    filenames = await readdir(PAGES_DIR)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return removed
  }

  for (const filename of filenames) {
    const slug = filename.replace(/\.(json|md)$/, '')
    if (filename === slug || keepSlugs.has(slug)) continue
    await rm(path.join(PAGES_DIR, filename))
    removed.push(filename)
  }

  return removed
}

/**
 * The rollup the website consumes. Site-wide fractions are weighted by word
 * count, so a long human post outweighs a short AI one.
 */
export function buildLatest (records, { siteUrl, model }) {
  const scored = records.filter(record => record.fractionAi != null)
  const totalWords = scored.reduce((sum, record) => sum + record.wordCount, 0)
  const weighted = key => totalWords
    ? scored.reduce((sum, record) => sum + record.wordCount * record[key], 0) / totalWords
    : 0

  return {
    siteUrl,
    model,
    generatedAt: new Date().toISOString(),
    repoUrl: REPO_URL,
    totalPages: scored.length,
    totalWords,
    fractionAi: weighted('fractionAi'),
    fractionAiAssisted: weighted('fractionAiAssisted'),
    fractionHuman: weighted('fractionHuman'),
    pages: sortByAi(records).map(toSummary)
  }
}

export async function writeLatest (latest) {
  await mkdir(RESULTS_DIR, { recursive: true })
  await writeFile(LATEST_PATH, `${JSON.stringify(latest, null, 2)}\n`)
}

export function sortByAi (records) {
  return [...records].sort((a, b) => {
    const delta = (b.fractionAi ?? -1) - (a.fractionAi ?? -1)
    return delta !== 0 ? delta : a.path.localeCompare(b.path)
  })
}

function toSummary (record) {
  return {
    path: record.path,
    slug: record.slug,
    url: record.url,
    title: record.title,
    wordCount: record.wordCount,
    headline: record.headline,
    fractionAi: record.fractionAi,
    fractionAiAssisted: record.fractionAiAssisted,
    fractionHuman: record.fractionHuman,
    checkedAt: record.checkedAt,
    dataUrl: dataUrl(record.slug)
  }
}
