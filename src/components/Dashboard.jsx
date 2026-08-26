import { useState } from 'react'
import { CATEGORIES } from '../data/menuData'

function Dashboard({ menuItems, salesLog, onResetSales }) {

    // =========================================================
    // DATE
    // =========================================================

    const getToday = () => {
        const today = new Date()
        const year = today.getFullYear()
        const month = String(today.getMonth() + 1).padStart(2, '0')
        const day = String(today.getDate()).padStart(2, '0')

        return `${year}-${month}-${day}`
    }

    const [selectedDate, setSelectedDate] = useState(getToday())

    // =========================================================
    // CONVERT SALE DATE
    // =========================================================

    const getSaleDate = (sale) => {

        const rawDate =
            sale.date ||
            sale.createdAt ||
            sale.timestamp ||
            sale.created_at ||
            sale.time

        if (!rawDate) return null

        // Firebase timestamp / JavaScript timestamp
        if (typeof rawDate === 'number') {

            const timestamp =
                rawDate < 10000000000
                    ? rawDate * 1000
                    : rawDate

            const date = new Date(timestamp)

            if (isNaN(date.getTime())) return null

            const year = date.getFullYear()
            const month = String(date.getMonth() + 1).padStart(2, '0')
            const day = String(date.getDate()).padStart(2, '0')

            return `${year}-${month}-${day}`
        }

        // Date string
        const date = new Date(rawDate)

        if (isNaN(date.getTime())) return null

        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')

        return `${year}-${month}-${day}`
    }

    // =========================================================
    // DAILY SALES
    // =========================================================

    const dailySales = salesLog.filter((sale) => {
        return getSaleDate(sale) === selectedDate
    })

    const totalOrders = dailySales.length

    const grossRevenue = dailySales.reduce(
        (sum, s) => sum + Number(s.total || 0),
        0
    )

    const vatCollected = dailySales.reduce(
        (sum, s) => sum + Number(s.vat || 0),
        0
    )

    const netRevenue = grossRevenue - vatCollected

    const avgOrderValue = totalOrders
        ? grossRevenue / totalOrders
        : 0

    // =========================================================
    // TOP SELLING ITEMS
    // =========================================================

    const itemStats = {}

    dailySales.forEach((sale) => {

        sale.items.forEach((it) => {

            if (!itemStats[it.name]) {
                itemStats[it.name] = {
                    name: it.name,
                    category: it.category,
                    qty: 0,
                    revenue: 0,
                }
            }

            itemStats[it.name].qty += Number(it.qty || 0)

            itemStats[it.name].revenue +=
                Number(it.price || 0) *
                Number(it.qty || 0)
        })
    })

    const topItems = Object.values(itemStats)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8)

    // =========================================================
    // CATEGORY COUNTS
    // =========================================================

    const categoryCounts = CATEGORIES.map((cat) => ({
        ...cat,
        count: menuItems.filter(
            (i) => i.category === cat.key
        ).length,
    }))

    // =========================================================
    // FORMATTED DATE
    // =========================================================

    const formattedSelectedDate = new Date(
        `${selectedDate}T00:00:00`
    ).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })

    // =========================================================
    // RETURN
    // =========================================================

    return (
        <div className="dashboard-page fade-in">

            {/* =================================================
                DASHBOARD HEADER
            ================================================= */}

            <div className="dashboard-title-row">

                <div>

                    <h1 className="dashboard-title">
                        Dashboard
                    </h1>

                    <p className="dashboard-subtitle">
                        Sales for {formattedSelectedDate}
                    </p>

                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) =>
                            setSelectedDate(e.target.value)
                        }
                        className="dashboard-date-input"
                    />

                </div>

                {totalOrders > 0 && (
                    <button
                        className="reset-sales-btn"
                        onClick={onResetSales}
                    >
                        Reset Sales Data
                    </button>
                )}

            </div>


            {/* =================================================
                SALES CARDS
            ================================================= */}

            <div className="dashboard-cards">

                <div className="dash-card">

                    <span className="dash-card-label">
                        GROSS REVENUE
                    </span>

                    <span className="dash-card-value">
                        ₱{grossRevenue.toFixed(2)}
                    </span>

                    <span className="dash-card-sub">
                        {totalOrders} orders
                    </span>

                </div>


                <div className="dash-card">

                    <span className="dash-card-label">
                        NET REVENUE
                    </span>

                    <span className="dash-card-value">
                        ₱{netRevenue.toFixed(2)}
                    </span>

                    <span className="dash-card-sub">
                        After 12% VAT
                    </span>

                </div>


                <div className="dash-card">

                    <span className="dash-card-label">
                        AVG ORDER VALUE
                    </span>

                    <span className="dash-card-value">
                        ₱{avgOrderValue.toFixed(2)}
                    </span>

                    <span className="dash-card-sub">
                        Per transaction
                    </span>

                </div>


                <div className="dash-card">

                    <span className="dash-card-label">
                        VAT COLLECTED
                    </span>

                    <span className="dash-card-value">
                        ₱{vatCollected.toFixed(2)}
                    </span>

                    <span className="dash-card-sub">
                        12% VAT
                    </span>

                </div>

            </div>


            {/* =================================================
                TOP SELLING ITEMS
            ================================================= */}

            {topItems.length > 0 && (

                <div
                    className="dashboard-breakdown"
                    style={{ marginBottom: 20 }}
                >

                    <h2>
                        Top Selling Items
                    </h2>

                    <table className="manage-menu-table">

                        <thead>

                            <tr>
                                <th>#</th>
                                <th>ITEM NAME</th>
                                <th>CATEGORY</th>
                                <th>QTY SOLD</th>
                                <th>REVENUE</th>
                            </tr>

                        </thead>

                        <tbody>

                            {topItems.map((item, idx) => (

                                <tr key={item.name}>

                                    <td>
                                        {idx + 1}
                                    </td>

                                    <td>
                                        {item.name}
                                    </td>

                                    <td>

                                        <span className="category-pill">
                                            {item.category}
                                        </span>

                                    </td>

                                    <td>
                                        {item.qty}
                                    </td>

                                    <td>
                                        ₱{item.revenue.toFixed(2)}
                                    </td>

                                </tr>

                            ))}

                        </tbody>

                    </table>

                </div>

            )}


            {/* =================================================
                MENU ITEMS PER CATEGORY
            ================================================= */}

            <div className="dashboard-breakdown">

                <h2>
                    Menu Items per Category
                </h2>

                {categoryCounts.map((cat) => (

                    <div
                        key={cat.key}
                        className="dash-bar-row"
                    >

                        <span className="dash-bar-label">
                            {cat.key}
                        </span>

                        <div className="dash-bar-track">

                            <div
                                className="dash-bar-fill"
                                style={{
                                    width: `${menuItems.length
                                        ? (cat.count /
                                            menuItems.length) *
                                        100
                                        : 0
                                        }%`,
                                    background: cat.color,
                                }}
                            />

                        </div>

                        <span className="dash-bar-count">
                            {cat.count}
                        </span>

                    </div>

                ))}

            </div>

        </div>
    )
}

export default Dashboard