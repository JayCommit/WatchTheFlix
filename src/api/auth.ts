import type { AuthUser } from '../types'
import { request } from './client'

export const authApi = {
  authStatus: () =>
    request<{ hasUsers: boolean; allowRegister: boolean; setupRequired: boolean }>(
      '/api/auth/status',
    ),
  me: () =>
    request<{ authed: boolean; user: AuthUser | null; setupRequired: boolean }>('/api/me'),
  login: (username: string, password: string) =>
    request<{ ok: boolean; user: AuthUser }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string) =>
    request<{ ok: boolean; user: AuthUser; createdAdmin?: boolean }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),
}
