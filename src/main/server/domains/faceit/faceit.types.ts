export interface FaceitPlayer {
  playerId: string
  nickname: string
  avatar: string
  steamId: string
}

export interface FaceitTeam {
  factionId: string
  name: string
  avatar: string
  players: FaceitPlayer[]
}

export interface FaceitMatchInfo {
  matchId: string
  competition: string
  bestOf: number
  status: string
  source: 'api' | 'public'
  teams: [FaceitTeam, FaceitTeam]
}

export interface FaceitImportResult {
  matchDbId: string
  teamsCreated: number
  teamsUpdated: number
  playersCreated: number
  playersUpdated: number
  warnings: string[]
}
