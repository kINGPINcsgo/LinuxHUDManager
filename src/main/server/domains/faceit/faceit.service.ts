import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { dbGet, dbRun } from '../../database/sqlite'
import { uploadsPath, deleteUploadedFile } from '../../utils/multer'
import { TeamRepository } from '../teams/team.repository'
import { PlayerRepository } from '../players/player.repository'
import { MatchRepository } from '../matches/match.repository'
import { FaceitImportResult, FaceitMatchInfo, FaceitPlayer, FaceitTeam } from './faceit.types'

const teamRepo = new TeamRepository()
const playerRepo = new PlayerRepository()
const matchRepo = new MatchRepository()

const API_KEY_SETTING = 'faceitApiKey'
const MATCH_ID_RE = /[0-9]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

// ---------- API key storage ----------

export const getApiKey = async (): Promise<string> => {
  const row = await dbGet('SELECT value FROM settings WHERE key = ?', [API_KEY_SETTING])
  return row?.value ?? ''
}

export const setApiKey = async (key: string): Promise<void> => {
  const trimmed = key.trim()
  if (!trimmed) {
    await dbRun('DELETE FROM settings WHERE key = ?', [API_KEY_SETTING])
    return
  }
  await dbRun(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [API_KEY_SETTING, trimmed]
  )
}

// ---------- Helpers ----------

/** Accepts a full FACEIT room URL or a bare match id like "1-xxxxxxxx-xxxx-..." */
export const parseMatchId = (input: string): string => {
  const m = (input ?? '').match(MATCH_ID_RE)
  if (!m) throw new Error('Keine gültige FACEIT-Match-ID gefunden (erwartet z. B. 1-b95833c0-e49a-...).')
  return m[0].toLowerCase()
}

const httpJson = async (url: string, headers: Record<string, string> = {}): Promise<any> => {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'LinuxHUDManager', ...headers },
    signal: AbortSignal.timeout(15000)
  })
  if (res.status === 404) throw new Error('Match nicht gefunden (404). Stimmt die Match-ID?')
  if (res.status === 401 || res.status === 403)
    throw new Error(`FACEIT hat den Zugriff abgelehnt (${res.status}). Ist der API-Key korrekt?`)
  if (!res.ok) throw new Error(`FACEIT-Anfrage fehlgeschlagen (HTTP ${res.status}).`)
  return res.json()
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg'
}

/** Downloads an image into the uploads folder. Returns "/api/uploads/<file>" or '' on failure. */
const downloadImage = async (url: string): Promise<string> => {
  if (!url || !/^https?:\/\//i.test(url)) return ''
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return ''
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const ext = EXT_BY_TYPE[type]
    if (!ext) return ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > 10 * 1024 * 1024) return ''
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`
    fs.writeFileSync(path.join(uploadsPath, name), buf)
    return `/api/uploads/${name}`
  } catch {
    return ''
  }
}

// ---------- Fetching match data ----------

const mapRosterV4 = (roster: any[]): FaceitPlayer[] =>
  (roster ?? []).map((p) => ({
    playerId: String(p.player_id ?? ''),
    nickname: String(p.nickname ?? p.game_player_name ?? ''),
    avatar: String(p.avatar ?? ''),
    steamId: String(p.game_player_id ?? '')
  }))

const fetchViaApi = async (matchId: string, key: string): Promise<FaceitMatchInfo> => {
  const d = await httpJson(`https://open.faceit.com/data/v4/matches/${matchId}`, {
    Authorization: `Bearer ${key}`
  })
  const mk = (f: any): FaceitTeam => ({
    factionId: String(f?.faction_id ?? ''),
    name: String(f?.name ?? ''),
    avatar: String(f?.avatar ?? ''),
    players: mapRosterV4(f?.roster)
  })
  return {
    matchId,
    competition: String(d.competition_name ?? ''),
    bestOf: Number(d.best_of ?? 1),
    status: String(d.status ?? ''),
    source: 'api',
    teams: [mk(d.teams?.faction1), mk(d.teams?.faction2)]
  }
}

// Best effort: the website's own (undocumented) endpoint, used when no API key is set.
const fetchViaPublic = async (matchId: string): Promise<FaceitMatchInfo> => {
  const d = await httpJson(`https://www.faceit.com/api/match/v2/match/${matchId}`)
  const p = d?.payload ?? d
  const mk = (f: any): FaceitTeam => ({
    factionId: String(f?.id ?? f?.faction_id ?? ''),
    name: String(f?.name ?? ''),
    avatar: String(f?.avatar ?? ''),
    players: (f?.roster ?? []).map((r: any) => ({
      playerId: String(r.id ?? r.player_id ?? ''),
      nickname: String(r.nickname ?? r.gameName ?? ''),
      avatar: String(r.avatar ?? ''),
      steamId: String(r.gameId ?? r.game_player_id ?? '')
    }))
  })
  const teams = p?.teams
  if (!teams?.faction1 || !teams?.faction2) throw new Error('Unerwartete Antwort von FACEIT (keine Teams gefunden).')
  return {
    matchId,
    competition: String(p.entity?.name ?? p.competition_name ?? ''),
    bestOf: Number(p.bestOf ?? p.best_of ?? 1),
    status: String(p.status ?? ''),
    source: 'public',
    teams: [mk(teams.faction1), mk(teams.faction2)]
  }
}

export const fetchMatch = async (input: string): Promise<FaceitMatchInfo> => {
  const matchId = parseMatchId(input)
  const key = await getApiKey()
  return key ? fetchViaApi(matchId, key) : fetchViaPublic(matchId)
}

// ---------- Import into the local database ----------

const shortNameFor = (name: string) => name.replace(/\s+/g, '').slice(0, 5).toUpperCase()

const findTeam = async (t: FaceitTeam) => {
  const all = await teamRepo.getTeams()
  return (
    all.find((x) => t.factionId && x.extra?.faceitId === t.factionId) ??
    all.find((x) => x.name.trim().toLowerCase() === t.name.trim().toLowerCase())
  )
}

export const importMatch = async (
  input: string,
  setCurrent: boolean
): Promise<FaceitImportResult> => {
  const info = await fetchMatch(input)
  const result: FaceitImportResult = {
    matchDbId: '',
    teamsCreated: 0,
    teamsUpdated: 0,
    playersCreated: 0,
    playersUpdated: 0,
    warnings: []
  }
  const teamIds: string[] = []

  for (const t of info.teams) {
    if (!t.name) throw new Error('FACEIT lieferte ein Team ohne Namen.')
    const logo = await downloadImage(t.avatar)
    if (!logo && t.avatar) result.warnings.push(`Logo von „${t.name}“ konnte nicht geladen werden.`)

    let team = await findTeam(t)
    if (team) {
      if (logo) deleteUploadedFile(team.logo)
      team = (await teamRepo.updateTeam(team._id, {
        name: t.name,
        logo: logo || team.logo,
        extra: { ...team.extra, faceitId: t.factionId }
      }))!
      result.teamsUpdated++
    } else {
      team = await teamRepo.createTeam({
        name: t.name,
        shortName: shortNameFor(t.name),
        country: '',
        logo,
        extra: { faceitId: t.factionId }
      })
      result.teamsCreated++
    }
    teamIds.push(team._id)

    for (const p of t.players) {
      if (!p.steamId) {
        result.warnings.push(`„${p.nickname}“ hat keine Steam-ID bei FACEIT und wurde übersprungen.`)
        continue
      }
      const avatar = await downloadImage(p.avatar)
      const existing = await playerRepo.getPlayerBySteamId(p.steamId)
      if (existing) {
        if (avatar) deleteUploadedFile(existing.avatar)
        await playerRepo.updatePlayer(existing._id, {
          username: p.nickname,
          team: team._id,
          avatar: avatar || existing.avatar,
          extra: { ...existing.extra, faceitId: p.playerId }
        })
        result.playersUpdated++
      } else {
        await playerRepo.createPlayer({
          firstName: '',
          lastName: '',
          username: p.nickname,
          avatar,
          country: '',
          steamid: p.steamId,
          team: team._id,
          isCoach: false,
          extra: { faceitId: p.playerId }
        })
        result.playersCreated++
      }
    }
  }

  const matchType = ([1, 2, 3, 5] as const).includes(info.bestOf as 1 | 2 | 3 | 5)
    ? (`bo${info.bestOf}` as 'bo1' | 'bo2' | 'bo3' | 'bo5')
    : 'bo1'
  if (setCurrent) await matchRepo.setAllMatchesNotCurrent()
  const match = await matchRepo.createMatch({
    current: setCurrent,
    left: { id: teamIds[0], wins: 0 },
    right: { id: teamIds[1], wins: 0 },
    matchType,
    vetos: []
  })
  result.matchDbId = match.id
  return result
}
