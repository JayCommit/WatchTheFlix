import { request } from './client'

export const profilesApi = {
  profiles: () =>
    request<{ profiles: Array<{ id: number; name: string }>; activeId: number }>('/api/profiles'),
  selectProfile: (id: number) =>
    request<{ ok: boolean }>(`/api/profiles/${id}/select`, { method: 'POST' }),
  createProfile: (name: string) =>
    request<{ profile: { id: number; name: string } }>('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  deleteProfile: (id: number) =>
    request<{ ok: boolean }>(`/api/profiles/${id}`, { method: 'DELETE' }),
}
