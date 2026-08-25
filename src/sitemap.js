/** Fetch and parse the site's sitemap.xml into a list of URLs. */
export async function fetchSitemapUrls (siteUrl) {
  const res = await fetch(new URL('/sitemap.xml', siteUrl))
  if (!res.ok) throw new Error(`Failed to fetch sitemap: ${res.status} ${res.statusText}`)

  const xml = await res.text()
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1])
  return urls
}

/**
 * Sitemap URLs for top-level pages only, e.g. /solitaire.
 *
 * Nested pages like /dial-a-repo/transcript are supporting material (raw
 * transcripts, appendices) rather than posts, so they're not worth spending
 * Pangram credits on. Pages whose source file is index.html rather than
 * index.md currently get an href ending in /index (e.g.
 * /bush-in-30-seconds/index); those are top-level pages despite the extra
 * segment, so they're kept.
 */
export async function fetchPageUrls (siteUrl) {
  const urls = await fetchSitemapUrls(siteUrl)
  return urls.filter(url => isTopLevelPage(url))
}

const EXCLUDED_PATHS = new Set(['/404/index'])

export function isTopLevelPage (url) {
  const path = pagePath(url)
  if (EXCLUDED_PATHS.has(path)) return false
  return /^\/[^/]+$/.test(path) || /^\/[^/]+\/index$/.test(path)
}

/** The site-relative path for a URL, without a trailing slash. */
export function pagePath (url) {
  const { pathname } = new URL(url)
  return pathname === '/' ? '/' : pathname.replace(/\/+$/, '')
}

/** Flat slug used for per-page result filenames: /bush-in-30-seconds/index -> bush-in-30-seconds */
export function pageSlug (url) {
  return pagePath(url).replace(/^\//, '').replace(/\/index$/, '')
}
