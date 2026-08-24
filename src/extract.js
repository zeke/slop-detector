import * as cheerio from 'cheerio'
import { createHash } from 'node:crypto'

import { pagePath, pageSlug } from './sitemap.js'

const MIN_WORD_COUNT = 50

// Elements removed before extraction. `.slop-indicator` is the banner the site
// renders from these very results, and `[data-slop-ignore]` marks other content
// generated from them (the table on /slop-detection). Leaving either in would
// change a page's text hash every time its own numbers change, re-triggering a
// paid rescan forever.
const NON_PROSE_SELECTOR = 'header, script, style, pre, code, iframe, svg, nav, .slop-indicator, [data-slop-ignore]'

/**
 * Fetch a page and extract its prose content, stripping nav/header chrome,
 * code blocks, and other non-prose elements that would confuse AI detection.
 */
export async function extractPage (url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)

  const html = await res.text()
  const $ = cheerio.load(html)

  const title = $('.page__title').first().text().trim()
  const description = $('.page__description').first().text().trim()

  const $content = $('article .page__content').first()
  $content.find(NON_PROSE_SELECTOR).remove()

  const text = normalizeWhitespace($content.text())
  const wordCount = text ? text.split(/\s+/).length : 0

  return {
    url,
    path: pagePath(url),
    slug: pageSlug(url),
    title,
    description,
    text,
    textHash: hashText(text),
    wordCount,
    skipped: wordCount < MIN_WORD_COUNT
  }
}

/** Content fingerprint used to decide whether a page needs to be checked again. */
export function hashText (text) {
  return createHash('sha256').update(text).digest('hex')
}

function normalizeWhitespace (text) {
  return text.replace(/\s+/g, ' ').trim()
}
