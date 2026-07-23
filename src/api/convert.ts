import type {
  CodecProbeCoverage,
  CodecProbeStatus,
  ConvertJob,
  ConvertNeedsFile,
} from '../types'
import { request } from './client'

export const convertApi = {
  convertJobs: () =>
    request<{
      jobs: ConvertJob[]
      stats: { queued: number; running: number; done: number; failed: number }
      localMediaEnabled: boolean
      deleteOriginalDefault: boolean
    }>('/api/admin/convert/jobs'),
  convertNeeds: (limit = 200) =>
    request<{ files: ConvertNeedsFile[]; localMediaEnabled: boolean }>(
      `/api/admin/convert/needs?limit=${limit}`,
    ),
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
    }>('/api/admin/convert/enqueue', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  convertCancel: (id: number) =>
    request<{ job: ConvertJob }>(`/api/admin/convert/jobs/${id}/cancel`, { method: 'POST' }),
}
