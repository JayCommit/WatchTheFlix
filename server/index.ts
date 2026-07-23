import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfig, publicConfigSummary } from './config.ts'
import { attachSession, type AuthVariables } from './auth-mw.ts'
import { startConvertWorker } from './convert.ts'
import { registerFeatureRoutes } from './features-api.ts'
import { startScanScheduler } from './scan-scheduler.ts'
import { registerAdminConvertRoutes } from './routes/admin-convert.ts'
import { registerAdminMonitorRoutes } from './routes/admin-monitor.ts'
import { registerAdminTitleRoutes } from './routes/admin-titles.ts'
import { registerAuthRoutes } from './routes/auth.ts'
import { registerLibraryRoutes } from './routes/library.ts'
import { registerPlaybackRoutes } from './routes/playback.ts'
import { registerScanRoutes } from './routes/scan.ts'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('/api/*', async (c, next) => {
  attachSession(c)
  await next()
})

registerAuthRoutes(app)
registerScanRoutes(app)
registerLibraryRoutes(app)
registerFeatureRoutes(app)
registerAdminTitleRoutes(app)
registerAdminMonitorRoutes(app)
registerPlaybackRoutes(app)
registerAdminConvertRoutes(app)

// Production static UI (never intercept /api/*)
const rootDir = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const distDir = join(rootDir, 'dist')
if (existsSync(distDir)) {
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) {
      return c.json({ error: 'Not found' }, 404)
    }
    return next()
  })
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api')) {
      return c.json({ error: 'Not found' }, 404)
    }
    const { readFile } = await import('node:fs/promises')
    const html = await readFile(join(distDir, 'index.html'), 'utf8')
    return c.html(html)
  })
}

const boot = getConfig()
const port = boot.port
const hostname = boot.host
console.log(`WatchTheFlix listening on http://${hostname}:${port}`)
console.log('Config:', publicConfigSummary())
if (!boot.webdavUrl || !boot.tmdbApiKey) {
  console.warn('Warning: SFTPGO_WEBDAV_URL and/or TMDB_API_KEY not set. Copy .env.example to .env')
}

startConvertWorker()
startScanScheduler()

serve({
  fetch: app.fetch,
  port,
  hostname,
})
