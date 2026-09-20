const API = 'https://api.sleeper.app/v1'
const ROOT = 'https://api.sleeper.app'

const PLAYERS_KEY = 'sleeper.players.nfl.v3'
const PLAYERS_TTL = 24 * 60 * 60 * 1000
const SCHEDULE_PATH = '/schedule/nfl/regular/'
const CANCELED = 'canceled'
const WEEKS_IN_SEASON = 18

let inflight = null

async function get(path) {
  const res = await fetch(API + path)
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json()
}

export const fpts = (s) => s.fpts + (s.fpts_decimal || 0) / 100

export const fptsAgainst = (s) =>
  s.fpts_against + (s.fpts_against_decimal || 0) / 100

export async function loadByeWeeks(season) {
  const res = await fetch(`${ROOT}${SCHEDULE_PATH}${season}`)
  if (!res.ok) throw new Error(`schedule ${season} -> ${res.status}`)

  const games = await res.json()
  if (!Array.isArray(games)) return {}

  const teams = new Set()
  const playedByTeam = new Map()

  for (const g of games) {
    teams.add(g.home)
    teams.add(g.away)

    if (g.status === CANCELED) continue

    for (const t of [g.home, g.away]) {
      let played = playedByTeam.get(t)
      if (!played) playedByTeam.set(t, (played = new Set()))
      played.add(g.week)
    }
  }

  const bye = {}

  for (const t of teams) {
    const played = playedByTeam.get(t)

    for (let w = 1; w <= WEEKS_IN_SEASON; w++) {
      if (!played?.has(w)) {
        bye[t] = w
        break
      }
    }
  }

  return bye
}

export async function loadPlayers(season) {
  try {
    const hit = JSON.parse(localStorage.getItem(PLAYERS_KEY) || 'null')
    if (hit && Date.now() - hit.at < PLAYERS_TTL && hit.season === season) {
      return hit
    }
  } catch {}

  if (inflight) return inflight

  inflight = (async () => {
    const [all, bye] = await Promise.all([
      get('/players/nfl'),
      loadByeWeeks(season).catch((err) => {
        console.warn('bye weeks unavailable:', err.message)
        return {}
      }),
    ])

    const byId = {}

    for (const id in all) {
      const p = all[id]
      if (!p) continue

      byId[id] = {
        name:
          p.full_name ||
          [p.first_name, p.last_name].filter(Boolean).join(' ') ||
          id,
        pos: p.position || '',
        team: p.team || '',
        num: p.number ?? null,
        bye: bye[p.team] ?? null,
      }
    }

    const payload = { at: Date.now(), season, byId }

    try {
      localStorage.setItem(PLAYERS_KEY, JSON.stringify(payload))
    } catch {}

    return payload
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

export const playersPromise = (season) =>
  loadPlayers(season)
    .then((p) => p.byId || {})
    .catch(() => ({}))

export async function findLeague(username) {
  const [user, state] = await Promise.all([
    get(`/user/${encodeURIComponent(username)}`),
    get('/state/nfl'),
  ])

  const start = Number(state.season)

  for (let y = start; y > start - 4; y--) {
    const found = await get(`/user/${user.user_id}/leagues/nfl/${y}`)
    if (found?.length) return { user, state, league: found[0], season: y }
  }

  return { user, state, league: null, season: null }
}

export async function loadLeague(leagueId, week) {
  const [rosters, users, matchups] = await Promise.all([
    get(`/league/${leagueId}/rosters`),
    get(`/league/${leagueId}/users`),
    get(`/league/${leagueId}/matchups/${week}`),
  ])

  return { rosters, users, matchups }
}

export function weekState(week, currentWeek, matchups) {
  if (!matchups?.length) return 'none'
  if (week < currentWeek) return 'complete'
  if (week > currentWeek) return 'upcoming'

  for (const m of matchups) {
    if ((m.points || 0) > 0) return 'live'
  }

  return 'scheduled'
}

export function teamName(user) {
  return user?.metadata?.team_name || user?.display_name || 'Unknown team'
}

export function indexBy(list, key) {
  const out = new Map()

  for (const item of list || []) out.set(item[key], item)

  return out
}

export function indexUsers(users) {
  return indexBy(users, 'user_id')
}

export function indexRosters(rosters) {
  return indexBy(rosters, 'roster_id')
}

export function groupMatchups(matchups) {
  const out = new Map()

  for (const m of matchups || []) {
    const bucket = out.get(m.matchup_id)
    if (bucket) bucket.push(m)
    else out.set(m.matchup_id, [m])
  }

  return [...out.entries()].sort((a, b) => a[0] - b[0])
}

export function maxPoints(matchups) {
  let max = 0

  for (const m of matchups) {
    const p = m.points || 0
    if (p > max) max = p
  }

  return max
}
