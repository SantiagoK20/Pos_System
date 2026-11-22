import { useEffect, useState } from 'react'
import { apiFetch, getApiUrl } from '../api'
import { getFirebaseAuthorizationHeader } from '../audit'
import '../audit.css'

async function request(path = '', options = {}) {
    const response = await apiFetch(getApiUrl(`administrator-requests${path}`), {
        ...options,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: await getFirebaseAuthorizationHeader(),
        },
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message || 'Administrator requests could not be loaded.')
    return result.data
}

export default function AdministratorRequests() {
    const [entries, setEntries] = useState([])
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(true)
    const [deciding, setDeciding] = useState(false)
    const [refresh, setRefresh] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        request('', { signal: controller.signal })
            .then((data) => { if (!controller.signal.aborted) setEntries(data) })
            .catch((error) => { if (!controller.signal.aborted) setMessage(error.message) })
            .finally(() => { if (!controller.signal.aborted) setLoading(false) })
        return () => controller.abort()
    }, [refresh])

    async function decide(entry, decision) {
        setDeciding(true)
        setMessage('')
        try {
            const updated = await request(`/${encodeURIComponent(entry.uid)}`, {
                method: 'PATCH',
                body: JSON.stringify({ decision }),
            })
            setEntries((current) => current.map((item) => item.uid === entry.uid ? updated : item))
        } catch (error) {
            setMessage(error.message)
        } finally {
            setDeciding(false)
        }
    }

    return (
        <section className="audit-page" aria-labelledby="administrator-requests">
            <header className="audit-header">
                <h1 id="administrator-requests">Administrator Requests</h1>
            </header>
            <div className="audit-controls">
                <button className="audit-refresh" type="button" disabled={loading || deciding} onClick={() => {
                    setMessage('')
                    setLoading(true)
                    setRefresh((value) => value + 1)
                }}>Refresh</button>
            </div>
            {message && <p className="audit-error" role="alert">{message}</p>}
            {loading && <p className="audit-empty" role="status">Loading requests…</p>}
            {!loading && !message && entries.length === 0 && <p className="audit-empty">No administrator requests.</p>}
            {entries.length > 0 && (
                <div className="audit-table-wrap">
                <table className="audit-table">
                    <thead>
                        <tr><th scope="col">Email</th><th scope="col">Verification</th><th scope="col">Request</th><th scope="col">Actions</th></tr>
                    </thead>
                    <tbody>
                        {entries.map((entry) => (
                            <tr key={entry.uid}>
                                <td>{entry.email}</td>
                                <td>{entry.email_verified ? 'Verified' : 'Unverified'}</td>
                                <td>{entry.status[0].toUpperCase() + entry.status.slice(1)}</td>
                                <td>
                                    {entry.status === 'pending' && (
                                        <>
                                            <button type="button" className="topbar-btn" disabled={loading || deciding || !entry.email_verified} onClick={() => decide(entry, 'approved')}>Approve</button>
                                            {' '}
                                            <button type="button" className="topbar-btn" disabled={loading || deciding} onClick={() => decide(entry, 'rejected')}>Reject</button>
                                        </>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            )}
        </section>
    )
}
