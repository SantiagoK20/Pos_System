import { useState } from 'react'
import { CATEGORIES } from '../data/menuData'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
} from 'recharts'

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

            <div
                className="dashboard-breakdown"
                style={{ marginBottom: 20 }}
            >

                <h2>
                    Top Selling Items Analytics
                </h2>

                <div style={{ width: '100%', height: 350, marginTop: 10 }}>
                    {topItems.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={topItems}
                                layout="vertical"
                                margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={true} vertical={true} />
                                <XAxis type="number" tickFormatter={(value) => `₱${value}`} />
                                <YAxis 
                                    dataKey="name" 
                                    type="category" 
                                    width={120} 
                                    tick={{ fontSize: 13, fill: '#666', fontWeight: 600 }} 
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip 
                                    cursor={false}
                                    isAnimationActive={false}
                                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                    formatter={(value, name, props) => [
                                        `₱${Number(value).toFixed(2)} (${props.payload.qty} sold)`, 
                                        'Revenue'
                                    ]}
                                />
                                <Bar 
                                    dataKey="revenue" 
                                    radius={[0, 4, 4, 0]} 
                                    barSize={24}
                                    fill="#f5a300"
                                    animationDuration={1000}
                                    activeBar={false}
                                >
                                    {
                                        topItems.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={['#f5a300', '#1b7a3d', '#2ecc71', '#29a8e0', '#e5484d', '#aa3bff', '#ff4d4f', '#faad14'][index % 8]} />
                                        ))
                                    }
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ 
                            height: '100%', 
                            display: 'flex', 
                            flexDirection: 'column',
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            color: '#888',
                            background: '#fafafa',
                            borderRadius: '8px',
                            border: '1px dashed #d9d9d9',
                            gap: '8px'
                        }}>
                            <span style={{ fontSize: '2em', opacity: 0.6 }}>📊</span>
                            <span style={{ fontSize: '0.95em', fontWeight: 600, color: '#777' }}>No sales data available for this date</span>
                        </div>
                    )}
                </div>

            </div>


            {/* =================================================
                MENU CATEGORIES
            ================================================= */}

            <div className="dashboard-breakdown">

                <h2>
                    Menu Categories
                </h2>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px', marginTop: '20px' }}>
                    {categoryCounts.map((cat) => (
                        <div 
                            key={cat.key} 
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'space-between',
                                background: 'white', 
                                border: '1px solid #eaeaea',
                                borderLeft: `6px solid ${cat.color}`,
                                borderRadius: '8px',
                                padding: '16px 20px',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
                                transition: 'box-shadow 0.2s ease',
                                cursor: 'default'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.06)'}
                            onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.03)'}
                        >
                            <span style={{ fontWeight: 700, fontSize: '0.95em', color: '#444' }}>
                                {cat.key}
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                <span style={{ fontSize: '1.6em', fontWeight: 800, color: '#222', lineHeight: 1 }}>
                                    {cat.count}
                                </span>
                                <span style={{ fontSize: '0.7em', fontWeight: 600, color: '#aaa', textTransform: 'uppercase', marginTop: '4px' }}>
                                    Items
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

            </div>

        </div>
    )
}

export default Dashboard