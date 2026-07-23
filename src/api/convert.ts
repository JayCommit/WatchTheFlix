import type {
  CodecProbeCoverage,
  CodecProbeStatus,
  ConvertJob,
  ConvertNeedsFile,
  ConvertQueueOptions,
} from '../types'
import { request } from './client'

export const convertApi = {
  convertJobs: () =>
    request<{
      jobs: ConvertJob[]
      stats: { queued: number; running: number; done: number; failed: number }
      localMediaEnabled: boolean
      deleteOriginalDefault: boolean
      options: ConvertQueueOptions
    }>('/api/admin/convert/jobs'),
  convertOptions: () =>
    request<{
      options: ConvertQueueOptions
      deleteOriginalDefault: boolean
      localMediaEnabled: boolean
    }>('/api/admin/convert/options'),
  convertSaveOptions: (options: Partial<ConvertQueueOptions>) =>
    request<{ options: ConvertQueueOptions; ok: boolean }>('/api/admin/convert/options', {
      method: 'PUT',
      body: JSON.stringify(options),
    }),
  convertNeeds: (opts?: {
    limit?: number
    offset?: number
    q?: string
    action?: 'all' | 'remux' | 'transcode' | 'unknown'
    kind?: 'movie' | 'tv' | ''
  }) => {
    const params = new URLSearchParams()
    params.set('limit', String(opts?.limit ?? 50))
    params.set('offset', String(opts?.offset ?? 0))
    if (opts?.q?.trim()) params.set('q', opts.q.trim())
    if (opts?.action && opts.action !== 'all') params.set('action', opts.action)
    if (opts?.kind) params.set('kind', opts.kind)
    return request<{
      files: ConvertNeedsFile[]
      total: number
      remuxCount: number
      transcodeCount: number
      unknownCount: number
      limit: number
      offset: number
      q: string
      action: 'all' | 'remux' | 'transcode' | 'unknown'
      kind: string
      localMediaEnabled: boolean
    }>(`/api/admin/convert/needs?${params.toString()}`)
  },
  convertProbe: (body?: { paths?: string[]; limit?: number }) =>
    request<{
      probed: number
      results: Array<{ path: string; ok: boolean; error?: string }>
      localMediaEnabled: boolean
    }>('/api/admin/convert/probe', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  convertProbeLibrary: (body?: { force?: boolean }) =>
    request<{
      ok: boolean
      started: boolean
      status: CodecProbeStatus
      coverage: CodecProbeCoverage
      localMediaEnabled: boolean
    }>('/api/admin/convert/probe-library', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  convertProbeStatus: () =>
    request<{
      running: boolean
      status: CodecProbeStatus
      coverage: CodecProbeCoverage
      localMediaEnabled: boolean
    }>('/api/admin/convert/probe-status'),
  convertProbeCancel: () =>
    request<{ ok: boolean; running: boolean; status: CodecProbeStatus }>(
      '/api/admin/convert/probe-cancel',
      { method: 'POST' },
    ),
  convertEnqueue: (body: {
    path?: string
    paths?: string[]
    mode?: 'auto' | 'remux' | 'transcode'
    replaceOriginal?: boolean
    deleteOriginal?: boolean
  }) =>
    request<{
      enqueued: number
      jobs: Array<{ job: ConvertJob | null }>
      errors: string[]
      stats: { queued: number; running: number; done: number; failed: number }
      options?: ConvertQueueOptions
    }>('/api/admin/convert/enqueue', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  convertCancel: (id: number) =>
    request<{ job: ConvertJob }>(`/api/admin/convert/jobs/${id}/cancel`, { method: 'POST' }),
}
