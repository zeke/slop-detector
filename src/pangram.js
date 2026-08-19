const TEXT_BASE_URL = 'https://text.external-api.pangram.com'

function apiKey () {
  const key = process.env.PANGRAM_API_KEY
  if (!key) throw new Error('PANGRAM_API_KEY is not set')
  return key
}

async function request (path, options = {}) {
  const res = await fetch(`${TEXT_BASE_URL}${path}`, {
    ...options,
    headers: {
      'x-api-key': apiKey(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Pangram API error ${res.status} ${res.statusText} on ${path}: ${body}`)
  }

  return res.json()
}

/** List model selectors enabled for this API key. */
export async function listModels () {
  const data = await request('/models')
  return data.models
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Submit one text for AI-detection and poll until it completes.
 * Returns the completed task payload (see docs.pangram.com/api-reference/ai-detection).
 */
export async function predict (text, { model = 'pangram-4', publicDashboardLink = false, timeout = 300_000, pollInterval = 1000 } = {}) {
  const { task_id: taskId } = await request('/task', {
    method: 'POST',
    body: JSON.stringify({ text, model, public_dashboard_link: publicDashboardLink })
  })

  const deadline = Date.now() + timeout
  while (true) {
    const result = await request(`/task/${taskId}`)
    if (result.stage === 'STAGE_SUCCESS' || result.stage === 'STAGE_FAILED') return result
    if (Date.now() > deadline) throw new Error(`Pangram task ${taskId} did not complete before timeout`)
    await sleep(pollInterval)
  }
}

/** Submit many texts as one bulk job. `items` is [{ id, text }]. */
export async function submitBulk (items, { model = 'pangram-4' } = {}) {
  return request('/bulk', {
    method: 'POST',
    body: JSON.stringify({ items, model })
  })
}

export async function getBulkStatus (bulkId) {
  return request(`/bulk/${bulkId}`)
}

/** Poll a bulk job until it reaches a terminal status. */
export async function waitForBulk (bulkId, { timeout = 3_600_000, pollInterval = 3000, onTick } = {}) {
  const deadline = Date.now() + timeout
  while (true) {
    const status = await getBulkStatus(bulkId)
    if (onTick) onTick(status)
    if (['succeeded', 'failed', 'partial'].includes(status.status)) return status
    if (Date.now() > deadline) throw new Error(`Bulk job ${bulkId} did not complete before timeout`)
    await sleep(pollInterval)
  }
}

/** Fetch all result pages for a bulk job. */
export async function getBulkResults (bulkId, { limit = 1000 } = {}) {
  const items = []
  const failedItems = []
  let offset = 0

  while (true) {
    const page = await request(`/bulk/${bulkId}/results?offset=${offset}&limit=${limit}`)
    items.push(...page.items)
    failedItems.push(...page.failed_items)
    offset += limit
    if (offset >= page.total_items) break
  }

  return { bulkId, items, failedItems }
}

/** Check text for plagiarism against a database of online content. */
export async function checkPlagiarism (text) {
  const res = await fetch('https://plagiarism.api.pangram.com', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Pangram plagiarism API error ${res.status} ${res.statusText}: ${body}`)
  }

  return res.json()
}
