/** Merge bulk API results with the page metadata gathered during extraction, sorted worst-first. */
export function buildRows (pages, bulkResults) {
  const pageByUrl = new Map(pages.map(page => [page.url, page]))

  const rows = bulkResults.items.map(item => {
    const page = pageByUrl.get(item.id)
    const result = item.result

    return {
      url: item.id,
      title: page ? page.title : item.id,
      stage: item.stage,
      error: item.error || null,
      fractionAi: result ? result.fraction_ai : null,
      fractionAiAssisted: result ? result.fraction_ai_assisted : null,
      fractionHuman: result ? result.fraction_human : null,
      headline: result ? result.headline : null,
      offendingWindows: result ? topOffendingWindows(result.windows) : []
    }
  })

  return rows.sort((a, b) => (b.fractionAi ?? -1) - (a.fractionAi ?? -1))
}

/** Windows flagged as AI-Generated or AI-Assisted, sorted by AI assistance score. */
function topOffendingWindows (windows = [], limit = 3) {
  return windows
    .filter(window => window.label !== 'Human Written')
    .sort((a, b) => b.ai_assistance_score - a.ai_assistance_score)
    .slice(0, limit)
    .map(window => ({
      text: window.text,
      label: window.label,
      score: window.ai_assistance_score,
      confidence: window.confidence,
      humanized: window.is_humanized
    }))
}

export function toMarkdown (rows, { siteUrl } = {}) {
  const lines = []
  lines.push('# Slop Detection Report')
  lines.push('')
  lines.push(`Generated ${new Date().toISOString()} against ${siteUrl || 'the site'} using Pangram.`)
  lines.push('')
  lines.push('| Page | Headline | AI | AI-Assisted | Human |')
  lines.push('|---|---|---|---|---|')

  for (const row of rows) {
    if (row.stage !== 'STAGE_SUCCESS') {
      lines.push(`| [${row.title}](${row.url}) | ${row.error || row.stage} | - | - | - |`)
      continue
    }
    lines.push(`| [${row.title}](${row.url}) | ${row.headline} | ${pct(row.fractionAi)} | ${pct(row.fractionAiAssisted)} | ${pct(row.fractionHuman)} |`)
  }

  const offenders = rows.filter(row => row.offendingWindows.length > 0)
  if (offenders.length) {
    lines.push('')
    lines.push('## Offending passages')
    for (const row of offenders) {
      lines.push('')
      lines.push(`### [${row.title}](${row.url})`)
      for (const window of row.offendingWindows) {
        lines.push('')
        lines.push(`- **${window.label}** (score ${window.score.toFixed(2)}, confidence ${window.confidence}${window.humanized ? ', flagged as humanized' : ''})`)
        lines.push(`  > ${window.text}`)
      }
    }
  }

  return `${lines.join('\n')}\n`
}

function pct (value) {
  if (value == null) return '-'
  return `${Math.round(value * 100)}%`
}
