import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import {
  findLeague,
  loadLeague,
  playersPromise,
  weekState,
  indexUsers,
  indexRosters,
} from './api'
import { MyTeam, Matchup, Standings, Section, Scoreboard } from './components'
import './index.css'

const USERNAME = 'cmchi'
const MAX_WEEK = 18
const EMPTY = {}

export default function App() {
  const [error, setError] = useState(null)
  const [meta, setMeta] = useState(null)
  const [week, setWeek] = useState(1)
  const [currentWeek, setCurrentWeek] = useState(1)
  const [hasWeek, setHasWeek] = useState(false)
  const [data, setData] = useState(null)
  const [players, setPlayers] = useState(EMPTY)
  const [isPending, startTransition] = useTransition()

  const season = meta?.season
  const leagueId = meta?.league?.league_id
  const userId = meta?.user?.user_id

  useEffect(() => {
    let alive = true

    findLeague(USERNAME)
      .then((m) => {
        if (!alive) return

        setMeta(m)
        const now = Math.max(1, m.state.display_week || m.state.week || 1)
        setCurrentWeek(now)
        setWeek(now)
        setHasWeek(true)
      })
      .catch((e) => alive && setError(e))

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!season) return

    let alive = true
    playersPromise(String(season)).then((p) => alive && setPlayers(p))

    return () => {
      alive = false
    }
  }, [season])

  const reload = useCallback(() => {
    if (!leagueId || !hasWeek) return

    return loadLeague(leagueId, week).then(setData).catch(setError)
  }, [leagueId, week, hasWeek])

  useEffect(() => {
    startTransition(() => {
      reload()
    })
  }, [reload])

  const rosterByOwner = useMemo(() => {
    const out = new Map()

    for (const r of data?.rosters || []) out.set(r.owner_id, r)

    return out
  }, [data])

  const myRoster = userId ? rosterByOwner.get(userId) : undefined

  const myWeek = useMemo(() => {
    if (!myRoster) return undefined

    const m = data?.matchups?.find((x) => x.roster_id === myRoster.roster_id)
    if (!m) return myRoster

    return {
      ...myRoster,
      starters: m.starters || [],
      players: m.players?.length ? m.players : myRoster.players,
    }
  }, [data, myRoster])

  const users = useMemo(() => indexUsers(data?.users), [data])

  const rosters = useMemo(() => indexRosters(data?.rosters), [data])

  const state = data ? weekState(week, currentWeek, data.matchups) : 'none'

  const decWeek = useCallback(() => setWeek((w) => Math.max(1, w - 1)), [])
  const incWeek = useCallback(() => setWeek((w) => Math.min(MAX_WEEK, w + 1)), [])

  if (error) {
    return (
      <main>
        <h1>Fantasy</h1>
        <p className="sub">Error: {error.message}</p>
      </main>
    )
  }

  return (
    <main>
      <h1>Fantasy</h1>
      <p className="sub">
        {meta ? (
          <>
            {meta.league?.name || `${USERNAME} — no leagues found`}
            {meta.league ? (
              <span className="dim">
                {' · '}
                {meta.season} · week {week}
                {state === 'live'
                  ? ' · in progress'
                  : state === 'complete'
                    ? ' · complete'
                    : state === 'upcoming'
                      ? ' · upcoming'
                      : null}
              </span>
            ) : null}
          </>
        ) : (
          'Loading…'
        )}
      </p>

      {meta?.league ? (
        <>
          <div className="bar">
            <button onClick={decWeek} disabled={week <= 1}>
              ←
            </button>
            <span className="dim">
              week {week} / {MAX_WEEK}
            </span>
            <button onClick={incWeek} disabled={week >= MAX_WEEK}>
              →
            </button>
            {isPending ? <span className="dim">loading…</span> : null}
          </div>

          {data ? (
            <>
              <MyTeam roster={myWeek} players={players} users={users} week={week} />
              <Matchup
                roster={myWeek}
                matchups={data.matchups}
                rosters={rosters}
                users={users}
                week={week}
              />
              <Standings
                rosters={data.rosters}
                users={users}
                myRosterId={myRoster?.roster_id}
              />

              <Section title="League scoreboard">
                <Scoreboard
                  matchups={data.matchups}
                  rosters={rosters}
                  users={users}
                  myRosterId={myRoster?.roster_id}
                />
              </Section>
            </>
          ) : null}
        </>
      ) : null}
    </main>
  )
}
