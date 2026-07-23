import { adminApi } from './admin'
import { authApi } from './auth'
import { convertApi } from './convert'
import { libraryApi } from './library'
import { playbackApi } from './playback'
import { profilesApi } from './profiles'
import { scanApi } from './scan'

export { AuthError } from './client'
export type { ScanSource, ScanProgress, ScanResult, ScanStatusResponse } from './types'

export const api = {
  ...authApi,
  ...libraryApi,
  ...scanApi,
  ...playbackApi,
  ...adminApi,
  ...convertApi,
  ...profilesApi,
}
