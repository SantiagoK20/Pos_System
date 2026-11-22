import { useEffect, useState } from 'react'
import { getFirebaseAuthorizationHeader } from '../audit'
import { apiFetch, getApiUrl } from '../api'
import '../audit.css'

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

export default function AuditLogs() {
  const [entries, setEntries] = useState([])
  const [integrityVerified, setIntegrityVerified] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [activity, setActivity] = useState('')
  const [removing, setRemoving] = useState(null)
  const [removalFeedback, setRemovalFeedback] = useState(null)

  const activities = [...new Set(entries.map((entry) => entry.event).filter(Boolean))].sort()
  const activeFilter = activities.includes(activity) ? activity : ''
  const query = search.trim().toLowerCase()
  const visibleEntries = entries.filter((entry) =>
    (!activeFilter || entry.event === activeFilter) &&
    [entry.event?.replaceAll('_', ' '), entry.actor_role, entry.actor_uid, entry.target_type, entry.target_id]
      .some((field) => String(field ?? '').toLowerCase().includes(query))
  )

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    async function loadEntries() {
      try {
        const response = await apiFetch(getApiUrl('audit-logs'), {
          signal: controller.signal,
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            Authorization: await getFirebaseAuthorizationHeader(),
          },
        })
        const result = await response.json()

        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Could not load audit logs.')
        }

        if (active) {
          setEntries(Array.isArray(result.data) ? result.data : [])
          setIntegrityVerified(result.integrity_verified === true)
          setErrorMessage('')
        }
      } catch (error) {
        if (active) {
          setErrorMessage(error.message || 'Could not load audit logs.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadEntries()

    return () => {
      active = false
      controller.abort()
    }
  }, [refresh])

  async function removeRestriction(entryId) {
    if (removing || !window.confirm('Remove this login restriction? Any IP-wide limit will still apply.')) return

    setRemoving(entryId)
    setRemovalFeedback(null)
    try {
      const response = await apiFetch(getApiUrl(`audit-logs/${encodeURIComponent(entryId)}/remove-login-restriction`), {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: await getFirebaseAuthorizationHeader(),
        },
      })
      const result = await response.json()
      if (result.status === 'removed' || (response.status === 410 && result.status === 'inactive')) {
        setEntries((previous) => previous.map((entry) =>
          entry.id === entryId ? { ...entry, can_remove_login_restriction: false } : entry
        ))
        setRefresh((previous) => previous + 1)
      }
      setRemovalFeedback({
        entryId,
        warning: result.auditRecorded === false || (!response.ok && response.status !== 410),
        message: result.message || 'Could not remove the login restriction.',
      })
    } catch {
      setRemovalFeedback({ entryId, warning: true, message: 'Could not remove the login restriction.' })
    } finally {
      setRemoving(null)
    }
  }

  return (
    <main className="audit-page">
      <header className="audit-header">
        <div>
          <h1>Audit Logs</h1>
          <p>Recent account and POS activity</p>
        </div>
        {!loading && !errorMessage && entries.length > 0 && (
          <div className={`audit-integrity ${integrityVerified ? 'valid' : 'invalid'}`}>
            {integrityVerified ? 'Entry signatures verified' : 'Integrity not verified'}
          </div>
        )}
      </header>

      <div className="audit-controls">
        <label>
          Search
          <input type="search" placeholder="Search audit logs" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          Activity
          <select value={activeFilter} onChange={(event) => setActivity(event.target.value)}>
            <option value="">All activities</option>
            {activities.map((event) => <option key={event} value={event}>{event.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
        <button className="audit-refresh" type="button" disabled={loading} onClick={() => {
          setLoading(true)
          setErrorMessage('')
          setRefresh((previous) => previous + 1)
        }}>Refresh</button>
      </div>

      {loading ? (
        <p className="audit-empty" role="status">Loading audit history…</p>
      ) : errorMessage ? (
        <div className="audit-error" role="alert">{errorMessage}</div>
      ) : entries.length === 0 ? (
        <p className="audit-empty">No activity has been recorded.</p>
      ) : visibleEntries.length === 0 ? (
        <p className="audit-empty">No activity matches these filters.</p>
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Activity</th>
                <th>Actor</th>
                <th>Target</th>
                <th>Integrity</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.map((entry) => {
                const valid = entry.integrity_valid === true
                return (
                  <tr key={entry.id}>
                    <td>{formatTime(entry.created_at)}</td>
                    <td>{String(entry.event || 'activity').replaceAll('_', ' ')}</td>
                    <td>
                      <span>{entry.actor_role || 'unknown'}</span>
                      {entry.actor_uid && <small>{entry.actor_uid}</small>}
                    </td>
                    <td>
                      {entry.target_type || '—'}
                      {entry.target_id && <small>{entry.target_id}</small>}
                      {entry.can_remove_login_restriction && (
                        <button
                          type="button"
                          className="audit-remove-restriction"
                          disabled={removing !== null}
                          onClick={() => removeRestriction(entry.id)}
                        >
                          {removing === entry.id ? 'Removing…' : 'Remove Login Restriction'}
                        </button>
                      )}
                      {removalFeedback?.entryId === entry.id && (
                        <small role={removalFeedback.warning ? 'alert' : 'status'}>{removalFeedback.message}</small>
                      )}
                    </td>
                    <td>
                      <span className={`audit-signature ${valid ? 'valid' : 'invalid'}`}>
                        {valid ? 'Valid' : 'Invalid'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
