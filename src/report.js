import { dataUrl } from './results.js'

/** Combine an extracted page with its Pangram result into a per-page record. */
export function buildRecord (page, result, { model, checkedAt = new Date().toISOString(), stage = 'STAGE_SUCCESS', error = null } = {}) {
  return {
    path: page.path,
    slug: page.slug,
    url: page.url,
    title: page.title,
    wordCount: page.wordCount,
    textHash: page.textHash,
    model,
    checkedAt,
    stage,
    error,
    headline: result ? result.headline : null,
    fractionAi: result ? result.fraction_ai : null,
    fractionAiAssisted: result ? result.fraction_ai_assisted : null,
    fractionHuman: result ? result.fraction_human : null,
    // Every window, in document order, so the report shows which parts of the
    // page are human and which are AI (not just the offending ones).
    windowsComplete: Boolean(result),
    windows: result ? result.windows.map(toWindow) : []
  }
}

function toWindow (window) {
  return {
    text: window.text,
    label: window.label,
    score: window.ai_assistance_score,
    confidence: window.confidence,
    humanized: window.is_humanized
  }
}

/** Human-readable per-page report. This is what the site's slop indicator links to. */
export function toPageMarkdown (record) {
  const lines = []
  lines.push(`# ${record.title || record.path}`)
  lines.push('')
  lines.push(`${record.url}`)
  lines.push('')

  if (record.stage !== 'STAGE_SUCCESS') {
    lines.push(`Check failed: ${record.error || record.stage}`)
    return `${lines.join('\n')}\n`
  }

  lines.push(`**${record.headline}** — ${pct(record.fractionAi)} AI, ${pct(record.fractionAiAssisted)} AI-assisted, ${pct(record.fractionHuman)} human.`)
  lines.push('')
  lines.push(`Checked ${record.checkedAt} with Pangram (model \`${record.model}\`) against ${record.wordCount} words of prose.`)
  lines.push('')

  if (!record.windows.length) {
    lines.push('No passage-level detail was saved for this check.')
    return `${lines.join('\n')}\n`
  }

  lines.push('## Passages')
  lines.push('')
  if (record.windowsComplete) {
    lines.push('Every passage Pangram scored, in document order.')
  } else {
    lines.push('Only the flagged passages from this check were saved. The page will show every passage after its next rescan.')
  }

  for (const window of record.windows) {
    lines.push('')
    lines.push(`### ${labelEmoji(window.label)} ${window.label}`)
    lines.push('')
    lines.push(`Score ${window.score.toFixed(2)}, ${window.confidence} confidence${window.humanized ? ', flagged as humanized' : ''}.`)
    lines.push('')
    lines.push(`> ${window.text}`)
  }

  return `${lines.join('\n')}\n`
}

/** Whole-site report for a single scan run. */
export function toMarkdown (records, { siteUrl } = {}) {
  const lines = []
  lines.push('# Slop Detection Report')
  lines.push('')
  lines.push(`Generated ${new Date().toISOString()} against ${siteUrl || 'the site'} using Pangram.`)
  lines.push('')
  lines.push('| Page | Headline | AI | AI-Assisted | Human | Details |')
  lines.push('|---|---|---|---|---|---|')

  for (const record of records) {
    if (record.stage !== 'STAGE_SUCCESS') {
      lines.push(`| [${record.title}](${record.url}) | ${record.error || record.stage} | - | - | - | [data](${dataUrl(record.slug)}) |`)
      continue
    }
    lines.push(`| [${record.title}](${record.url}) | ${record.headline} | ${pct(record.fractionAi)} | ${pct(record.fractionAiAssisted)} | ${pct(record.fractionHuman)} | [data](${dataUrl(record.slug)}) |`)
  }

  return `${lines.join('\n')}\n`
}

function labelEmoji (label) {
  if (label === 'Human Written') return '✅'
  if (label === 'AI-Assisted') return '⚠️'
  return '🤖'
}

function pct (value) {
  if (value == null) return '-'
  return `${Math.round(value * 100)}%`
}
