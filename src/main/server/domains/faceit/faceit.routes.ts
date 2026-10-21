import { Router, Request, Response } from 'express'
import { Server } from 'socket.io'
import { syncGSITeams } from '../../integrations/gsi'
import { fetchMatch, importMatch, getApiKey, setApiKey } from './faceit.service'

export default function createFaceitRouter(io: Server): Router {
  const router = Router()

  // The API key itself is never sent back to the client, only whether one is set.
  router.get('/settings', async (_req: Request, res: Response) => {
    const key = await getApiKey()
    res.json({ apiKeySet: key.length > 0, apiKeyHint: key ? `…${key.slice(-4)}` : '' })
  })

  router.put('/settings', async (req: Request, res: Response) => {
    try {
      await setApiKey(String(req.body?.apiKey ?? ''))
      const key = await getApiKey()
      res.json({ apiKeySet: key.length > 0, apiKeyHint: key ? `…${key.slice(-4)}` : '' })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/preview', async (req: Request, res: Response) => {
    try {
      res.json(await fetchMatch(String(req.body?.input ?? '')))
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })

  router.post('/import', async (req: Request, res: Response) => {
    try {
      const result = await importMatch(String(req.body?.input ?? ''), req.body?.setCurrent !== false)
      if (req.body?.setCurrent !== false) {
        io.emit('match')
        syncGSITeams()
      }
      res.json(result)
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })

  return router
}
