import * as cheerio from 'cheerio'

const MIN_WORD_COUNT = 50

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
  $content.find('header, script, style, pre, code, iframe, svg, nav').remove()

  const text = normalizeWhitespace($content.text())
  const wordCount = text ? text.split(/\s+/).length : 0

  return {
    url,
    title,
    description,
    text,
    wordCount,
    skipped: wordCount < MIN_WORD_COUNT
  }
}

function normalizeWhitespace (text) {
  return text.replace(/\s+/g, ' ').trim()
}
