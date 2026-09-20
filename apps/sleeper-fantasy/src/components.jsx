import {
  fpts,
  fptsAgainst,
  teamName,
  groupMatchups,
  maxPoints,
} from './api'

export function Section({ title, children }) {
  return (
    <>
      <h2>{title}</h2>
      {children}
    </>
  )
}

export function PlayerTable({ players, ids, showTeam = true, bench = false, currentWeek }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Pos</th>
          <th className="col-num">#</th>
          <th>Player</th>
          {showTeam ? <th className="col-team">Team</th> : null}
          <th className="col-bye num">Bye</th>
        </tr>
      </thead>
      <tbody>
        {ids.map((id) => {
          const p = players[id]
          const bye = p?.bye
          const onBye = bye === currentWeek

          const byeClass =
            bye == null || bye < currentWeek ? 'dim' : onBye ? 'loss' : ''

          return (
            <tr
              key={id}
              className={[bench ? 'bench' : '', onBye ? 'on-bye' : '']
                .filter(Boolean)
                .join(' ')}
            >
              <td>
                <span className="pos">{p?.pos || ''}</span>
              </td>
              <td className="col-num dim">{p?.num ?? ''}</td>
              <td>{p?.name || id}</td>
              {showTeam ? <td className="col-team dim">{p?.team || ''}</td> : null}
              <td className={`col-bye num ${byeClass}`}>
                {bye == null ? '—' : bye}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function StatTable({ rows }) {
  return (
    <table>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td className="dim">{label}</td>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function byeConflicts(starters, players) {
  const groups = new Map()

  for (const id of starters) {
    const bye = players[id]?.bye
    if (bye == null) continue

    const bucket = groups.get(bye)
    if (bucket) bucket.push(players[id]?.name || id)
    else groups.set(bye, [players[id]?.name || id])
  }

  const out = []

  for (const [bye, names] of groups) {
    if (names.length > 1) out.push([bye, names])
  }

  return out.sort((a, b) => a[0] - b[0])
}

export function MyTeam({ roster, players, users, week }) {
  if (!roster) return <p className="empty">No roster found for this user.</p>

  const starters = new Set(roster.starters || [])
  const bench = (roster.players || []).filter((id) => !starters.has(id))
  const s = roster.settings
  const owner = users.get(roster.owner_id)
  const conflicts = byeConflicts(starters, players)

  return (
    <>
      <Section
        title={
          <>
            <span className="me">{teamName(owner)}</span> — starters · week {week}
          </>
        }
      >
        <PlayerTable players={players} ids={roster.starters || []} currentWeek={week} />
      </Section>

      {conflicts.length > 0 ? (
        <p className="sub">
          Bye conflicts:{' '}
          {conflicts.map(([bye, names]) => `wk ${bye} — ${names.join(', ')}`).join(' · ')}
        </p>
      ) : null}

      {bench.length > 0 ? (
        <Section title={`Bench (${bench.length})`}>
          <PlayerTable players={players} ids={bench} bench currentWeek={week} />
        </Section>
      ) : null}

      <Section title="Record">
        <StatTable
          rows={[
            ['Record', `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`],
            ['Points for', fpts(s).toFixed(2)],
            ['Points against', fptsAgainst(s).toFixed(2)],
            ['Season differential', (fpts(s) - fptsAgainst(s)).toFixed(2)],
            ['Waiver position', s.waiver_position],
            ['Moves', s.total_moves],
          ]}
        />
      </Section>
    </>
  )
}

export function Matchup({ roster, matchups, rosters, users, week }) {
  if (!roster || !matchups?.length) return null

  const mine = matchups.find((m) => m.roster_id === roster.roster_id)

  const opp = mine
    ? matchups.find(
        (m) => m.matchup_id === mine.matchup_id && m.roster_id !== mine.roster_id,
      )
    : null

  if (!opp) {
    return (
      <Section title={`Week ${week}`}>
        <p className="empty">No matchup this week (bye or playoffs).</p>
      </Section>
    )
  }

  const oppRoster = rosters.get(opp.roster_id)
  const myPts = mine.points || 0
  const oppPts = opp.points || 0
  const lead = myPts === oppPts ? 'dim' : myPts > oppPts ? 'win' : 'loss'

  return (
    <Section title={`Week ${week} matchup`}>
      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th className="num">Points</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="me">{teamName(users.get(roster.owner_id))}</td>
            <td className={`num ${lead}`}>{myPts.toFixed(2)}</td>
          </tr>
          <tr>
            <td>
              {oppRoster ? teamName(users.get(oppRoster.owner_id)) : `Roster ${opp.roster_id}`}
            </td>
            <td className="num">{oppPts.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </Section>
  )
}

export function Standings({ rosters, users, myRosterId }) {
  const rows = [...rosters]
    .map((r) => ({ r, pf: fpts(r.settings), pa: fptsAgainst(r.settings) }))
    .sort(
      (a, b) =>
        b.r.settings.wins - a.r.settings.wins ||
        a.r.settings.losses - b.r.settings.losses ||
        b.pf - a.pf,
    )

  return (
    <Section title="Standings">
      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th className="num">W-L</th>
            <th className="num">PF</th>
            <th className="num col-team">PA</th>
            <th className="num">DIFF</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, pf, pa }) => {
            const diff = pf - pa

            return (
              <tr key={r.roster_id}>
                <td className={r.roster_id === myRosterId ? 'me' : undefined}>
                  {teamName(users.get(r.owner_id))}
                </td>
                <td className="num">
                  {r.settings.wins}-{r.settings.losses}
                </td>
                <td className="num">{pf.toFixed(2)}</td>
                <td className="num col-team">{pa.toFixed(2)}</td>
                <td className={`num ${diff > 0 ? 'win' : diff < 0 ? 'loss' : 'dim'}`}>
                  {diff > 0 ? '+' : ''}
                  {diff.toFixed(2)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}

export function Scoreboard({ matchups, rosters, users, myRosterId }) {
  const pairs = groupMatchups(matchups)

  if (!pairs.length) return <p className="empty">No games this week.</p>

  return (
    <table>
      <thead>
        <tr>
          <th>Matchup</th>
          <th>Team</th>
          <th className="num">Points</th>
        </tr>
      </thead>
      <tbody>
        {pairs.map(([id, ms]) => {
          const hi = maxPoints(ms)

          return ms.map((m, i) => (
            <tr key={`${id}-${m.roster_id}`}>
              <td className="dim">{i === 0 ? `#${id}` : ''}</td>
              <td className={m.roster_id === myRosterId ? 'me' : undefined}>
                {nameForRoster(m.roster_id, rosters, users)}
              </td>
              <td className={`num ${(m.points || 0) === hi && hi > 0 ? 'win' : ''}`}>
                {(m.points || 0).toFixed(2)}
              </td>
            </tr>
          ))
        })}
      </tbody>
    </table>
  )
}

function nameForRoster(rosterId, rosters, users) {
  const r = rosters.get(rosterId)
  if (!r) return `Roster ${rosterId}`

  const u = users.get(r.owner_id)
  return u?.metadata?.team_name || u?.display_name || `Roster ${rosterId}`
}
