import logo from '../assets/logo.png'

function TopBar({ role, view, onNavigate, onLogout }) {
    return (
        <div className="topbar">
            <div className="topbar-left">

                {/* Atecles Grill Logo */}
                <img
                    src={logo}
                    alt="Atecles Grill"
                    className="topbar-logo"
                />

                <span className="topbar-title">Atecles Grill</span>

                {role === 'admin' && (
                    <span className="topbar-badge">ADMIN</span>
                )}
            </div>

            <div className="topbar-right">
                {role === 'admin' && (
                    <>
                        <button
                            className={`topbar-btn ${view === 'dashboard' ? 'active' : ''
                                }`}
                            onClick={() => onNavigate('dashboard')}
                        >
                            Dashboard
                        </button>

                        <button
                            className={`topbar-btn ${view === 'manageMenu' ? 'active' : ''
                                }`}
                            onClick={() => onNavigate('manageMenu')}
                        >
                            Manage Menu
                        </button>

                        <button
                            className={`topbar-btn ${view === 'manageCashiers' ? 'active' : ''
                                }`}
                            onClick={() => onNavigate('manageCashiers')}
                        >
                            Manage Cashiers
                        </button>
                    </>
                )}

                <button
                    className="topbar-btn logout"
                    onClick={onLogout}
                >
                    Log Out
                </button>
            </div>
        </div>
    )
}

export default TopBar