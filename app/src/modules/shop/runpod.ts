import { config } from '../../config.js'

// The digitization worker is dormant until its RunPod endpoint + key are set.
export function ingestConfigured(): boolean {
  return !!config.runpodEndpoint && !!config.runpodApiKey
}

interface RunResp {
  id?: string
  status?: string
  output?: unknown
  error?: unknown
}

// Call the RunPod serverless worker and poll until the job finishes.
export async function callWorker(
  input: Record<string, unknown>,
  timeoutMs = 180_000,
): Promise<Record<string, unknown>> {
  const base = config.runpodEndpoint.replace(/\/$/, '')
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.runpodApiKey}`,
  }
  const run = (await fetch(`${base}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input }),
  }).then((r) => r.json())) as RunResp
  if (!run.id) throw new Error('RunPod did not return a job id')

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    const s = (await fetch(`${base}/status/${run.id}`, { headers }).then((r) => r.json())) as RunResp
    if (s.status === 'COMPLETED') return (s.output ?? {}) as Record<string, unknown>
    if (s.status === 'FAILED' || s.status === 'CANCELLED') {
      throw new Error(`RunPod job ${s.status}: ${JSON.stringify(s.error ?? s).slice(0, 300)}`)
    }
  }
  throw new Error('RunPod job timed out')
}
