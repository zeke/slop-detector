/** Fetch and parse the site's sitemap.xml into a list of URLs. */
export async function fetchSitemapUrls (siteUrl) {
  const res = await fetch(new URL('/sitemap.xml', siteUrl))
  if (!res.ok) throw new Error(`Failed to fetch sitemap: ${res.status} ${res.statusText}`)

  const xml = await res.text()
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1])
  return urls
}
