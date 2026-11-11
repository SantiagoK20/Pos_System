import { useState } from 'react'
import { CATEGORIES } from '../data/menuData'

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts'


function Dashboard({
    menuItems = [],
    salesLog = [],
    onResetSales,
}) {

    // =========================================================
    // TODAY
    // =========================================================

    const getToday = () => {
        const today = new Date()

        const year = today.getFullYear()

        const month = String(
            today.getMonth() + 1
        ).padStart(2, '0')

        const day = String(
            today.getDate()
        ).padStart(2, '0')

        return `${year}-${month}-${day}`
    }


    // =========================================================
    // STATES
    // =========================================================

    const [selectedDate, setSelectedDate] =
        useState(getToday())

    const [selectedCategory, setSelectedCategory] =
        useState('ALL')


    // =========================================================
    // GET SALE DATE
    // =========================================================

    const getSaleDate = (sale) => {

        const rawDate =
            sale.date ||
            sale.createdAt ||
            sale.created_at ||
            sale.timestamp ||
            sale.time

        if (!rawDate) {
            return null
        }


        // ---------------------------------------------------------
        // NUMBER TIMESTAMP
        // ---------------------------------------------------------

        if (typeof rawDate === 'number') {

            const timestamp =
                rawDate < 10000000000
                    ? rawDate * 1000
                    : rawDate

            const date = new Date(timestamp)

            if (isNaN(date.getTime())) {
                return null
            }

            const year =
                date.getFullYear()

            const month =
                String(
                    date.getMonth() + 1
                ).padStart(2, '0')

            const day =
                String(
                    date.getDate()
                ).padStart(2, '0')

            return `${year}-${month}-${day}`
        }


        // ---------------------------------------------------------
        // DATE STRING
        // ---------------------------------------------------------

        const date = new Date(rawDate)

        if (isNaN(date.getTime())) {
            return null
        }

        const year =
            date.getFullYear()

        const month =
            String(
                date.getMonth() + 1
            ).padStart(2, '0')

        const day =
            String(
                date.getDate()
            ).padStart(2, '0')

        return `${year}-${month}-${day}`
    }


    // =========================================================
    // SALES FOR SELECTED DATE
    // =========================================================

    const dailySales = salesLog.filter(
        (sale) =>
            getSaleDate(sale) === selectedDate
    )


    // =========================================================
    // SALES OVERVIEW
    // =========================================================

    const totalOrders =
        dailySales.length


    const grossRevenue =
        dailySales.reduce(
            (sum, sale) =>
                sum +
                Number(
                    sale.total || 0
                ),
            0
        )


    const vatCollected =
        dailySales.reduce(
            (sum, sale) =>
                sum +
                Number(
                    sale.vat || 0
                ),
            0
        )


    const netRevenue =
        grossRevenue -
        vatCollected


    const avgOrderValue =
        totalOrders > 0
            ? grossRevenue / totalOrders
            : 0


    // =========================================================
    // FIREBASE CATEGORIES
    //
    // ONLY CURRENT FIREBASE MENU ITEMS ARE USED.
    // =========================================================

    const firebaseCategories = [
        ...new Set(
            menuItems
                .map(
                    (item) =>
                        item.category
                )
                .filter(Boolean)
        ),
    ]


    // =========================================================
    // TOP 10 BEST-SELLING ITEMS
    //
    // IMPORTANT:
    //
    // We LOOP THROUGH menuItems FIRST.
    //
    // menuItems = CURRENT FIREBASE MENU
    //
    // Therefore an item that no longer exists in Firebase
    // CANNOT appear in this list.
    // =========================================================

    const currentMenuSales =
        menuItems.map((menuItem) => {

            let qty = 0
            let revenue = 0


            // -----------------------------------------------------
            // CHECK TODAY'S SALES
            // -----------------------------------------------------

            dailySales.forEach((sale) => {

                if (
                    !Array.isArray(
                        sale.items
                    )
                ) {
                    return
                }


                sale.items.forEach(
                    (saleItem) => {

                        let isSameItem =
                            false


                        // -------------------------------------------------
                        // MATCH BY ID
                        // -------------------------------------------------

                        if (
                            menuItem.id !==
                            undefined &&
                            menuItem.id !==
                            null &&
                            saleItem.id !==
                            undefined &&
                            saleItem.id !==
                            null
                        ) {

                            isSameItem =
                                String(
                                    menuItem.id
                                ) ===
                                String(
                                    saleItem.id
                                )
                        }


                        // -------------------------------------------------
                        // FALLBACK MATCH BY NAME
                        //
                        // Used only when an ID is missing.
                        // -------------------------------------------------

                        if (
                            !isSameItem &&
                            (
                                saleItem.id ===
                                undefined ||
                                saleItem.id ===
                                null ||
                                menuItem.id ===
                                undefined ||
                                menuItem.id ===
                                null
                            )
                        ) {

                            const menuName =
                                String(
                                    menuItem.name ||
                                    ''
                                )
                                    .trim()
                                    .toLowerCase()

                            const saleName =
                                String(
                                    saleItem.name ||
                                    ''
                                )
                                    .trim()
                                    .toLowerCase()

                            isSameItem =
                                menuName !== '' &&
                                menuName ===
                                saleName
                        }


                        if (!isSameItem) {
                            return
                        }


                        // -------------------------------------------------
                        // QUANTITY
                        // -------------------------------------------------

                        const saleQty =
                            Number(
                                saleItem.qty ??
                                saleItem.quantity ??
                                0
                            )


                        // -------------------------------------------------
                        // PRICE
                        //
                        // First use the price recorded in the sale.
                        //
                        // If old sales do not contain a price,
                        // use the current Firebase menu price.
                        // -------------------------------------------------

                        const salePrice =
                            Number(
                                saleItem.price ??
                                menuItem.price ??
                                0
                            )


                        qty += saleQty

                        revenue +=
                            saleQty *
                            salePrice
                    }
                )
            })


            // ---------------------------------------------------------
            // RETURN CURRENT FIREBASE ITEM
            // ---------------------------------------------------------

            return {
                id:
                    menuItem.id ??
                    menuItem.key ??
                    menuItem.name,

                name:
                    menuItem.name ||
                    'Unnamed Item',

                category:
                    menuItem.category ||
                    '',

                price:
                    Number(
                        menuItem.price || 0
                    ),

                qty,

                revenue,
            }
        })


    // =========================================================
    // CATEGORY FILTER
    // =========================================================

    const filteredMenuSales =
        selectedCategory === 'ALL'
            ? currentMenuSales
            : currentMenuSales.filter(
                (item) =>
                    item.category ===
                    selectedCategory
            )


    // =========================================================
    // TOP ITEMS BY QUANTITY SOLD
    // =========================================================

    const topItems =
        filteredMenuSales
            .filter(
                (item) =>
                    item.qty > 0
            )
            .sort(
                (a, b) => {

                    // Highest quantity sold first
                    if (b.qty !== a.qty) {
                        return b.qty - a.qty
                    }

                    if (
                        b.revenue !==
                        a.revenue
                    ) {
                        return (
                            b.revenue -
                            a.revenue
                        )
                    }

                    return (
                        b.qty -
                        a.qty
                    )
                }
            )
            .slice(0, 10)


    // =========================================================
    // MENU CATEGORIES
    //
    // EXISTING CATEGORY DESIGN IS KEPT.
    // =========================================================

    const categoryCounts =
        CATEGORIES.map(
            (category) => ({

                ...category,

                count:
                    menuItems.filter(
                        (item) =>
                            item.category ===
                            category.key
                    ).length,
            })
        )


    // =========================================================
    // =========================================================
    // SALES TREND
    //
    // DAILY REVENUE FOR THE SELECTED MONTH
    // =========================================================

    const [selectedYear, selectedMonth] = selectedDate
        .split('-')
        .map(Number)
    const salesTrendDays = new Date(
        selectedYear,
        selectedMonth,
        0
    ).getDate()
    const salesTrendMonthLabel = new Date(
        selectedYear,
        selectedMonth - 1,
        1
    ).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
    })
    const salesTrend = []


    for (
        let day = 1;
        day <= salesTrendDays;
        day++
    ) {

        const date = [
            selectedYear,
            String(selectedMonth).padStart(2, '0'),
            String(day).padStart(2, '0'),
        ].join('-')


        const salesForDate =
            salesLog.filter(
                (sale) =>
                    getSaleDate(
                        sale
                    ) === date
            )


        const revenue =
            salesForDate.reduce(
                (sum, sale) =>
                    sum +
                    Number(
                        sale.total || 0
                    ),
                0
            )


        const dateObject =
            new Date(
                `${date}T00:00:00`
            )


        const label =
            dateObject.toLocaleDateString(
                'en-US',
                {
                    month: 'short',
                    day: 'numeric',
                }
            )


        salesTrend.push({
            date,
            label,
            revenue,
        })
    }


    // =========================================================
    // FORMATTED SELECTED DATE
    // =========================================================

    const formattedSelectedDate =
        new Date(
            `${selectedDate}T00:00:00`
        ).toLocaleDateString(
            'en-US',
            {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            }
        )


    // =========================================================
    // RETURN
    // =========================================================

    return (

        <div className="dashboard-page fade-in">


            {/* =================================================
                HEADER
            ================================================= */}

            <div className="dashboard-title-row">
                <div className="dashboard-title-center">
                    <h1 className="dashboard-title">
                        Analytics
                    </h1>

                    <p className="dashboard-subtitle">
                        Sales for {formattedSelectedDate}
                    </p>
                </div>

                <div className="dashboard-header-controls">
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) =>
                            setSelectedDate(
                                e.target.value
                            )
                        }
                        className="dashboard-date-input"
                    />

                    {totalOrders > 0 && (
                        <button
                            className="reset-sales-btn"
                            onClick={onResetSales}
                        >
                            Reset Sales Data
                        </button>
                    )}
                </div>
            </div>


            {/* =================================================
                SALES OVERVIEW
            ================================================= */}

            <div className="dashboard-cards">


                {/* GROSS REVENUE */}

                <div className="dash-card">

                    <span className="dash-card-label">
                        GROSS REVENUE
                    </span>


                    <span className="dash-card-value">

                        ₱
                        {grossRevenue.toFixed(2)}

                    </span>


                    <span className="dash-card-sub">
                        Total sales
                    </span>

                </div>


                {/* NET REVENUE */}

                <div className="dash-card">

                    <span className="dash-card-label">
                        NET REVENUE
                    </span>


                    <span className="dash-card-value">

                        ₱
                        {netRevenue.toFixed(2)}

                    </span>


                    <span className="dash-card-sub">
                        After VAT
                    </span>

                </div>


                {/* TOTAL ORDERS */}

                <div className="dash-card">

                    <span className="dash-card-label">
                        TOTAL ORDERS
                    </span>


                    <span className="dash-card-value">
                        {totalOrders}
                    </span>


                    <span className="dash-card-sub">
                        Completed transactions
                    </span>

                </div>


                {/* AVERAGE ORDER VALUE */}

                <div className="dash-card">

                    <span className="dash-card-label">
                        AVG ORDER VALUE
                    </span>


                    <span className="dash-card-value">

                        ₱
                        {avgOrderValue.toFixed(2)}

                    </span>


                    <span className="dash-card-sub">
                        Per transaction
                    </span>

                </div>

            </div>


            {/* =================================================
                SALES TREND
            ================================================= */}

            <div
                className="dashboard-breakdown"
                style={{
                    marginBottom: 20,
                }}
            >

                <h2>
                    Sales Trend
                </h2>


                <p
                    style={{
                        fontSize: '0.85em',
                        color: '#888',
                        marginBottom: '10px',
                    }}
                >
                    Daily revenue for {salesTrendMonthLabel}.
                </p>


                <div
                    style={{
                        width: '100%',
                        height: 320,
                        marginTop: 10,
                    }}
                >

                    <ResponsiveContainer
                        width="100%"
                        height="100%"
                    >

                        <LineChart
                            data={salesTrend}
                            margin={{
                                top: 10,
                                right: 20,
                                left: 10,
                                bottom: 10,
                            }}
                            isAnimationActive={false}
                        >

                            <CartesianGrid
                                strokeDasharray="3 3"
                                opacity={0.3}
                            />


                            <XAxis
                                dataKey="label"
                            />


                            <YAxis
                                tickFormatter={
                                    (value) =>
                                        `₱${value}`
                                }
                            />


                            <Tooltip
                                formatter={
                                    (value) => [
                                        `₱${Number(
                                            value
                                        ).toFixed(2)}`,
                                        'Revenue',
                                    ]
                                }
                            />


                            {/* NO ANIMATION */}

                            <Line
                                type="monotone"
                                dataKey="revenue"
                                stroke="#1b7a3d"
                                strokeWidth={3}
                                dot={{
                                    r: 4,
                                }}
                                activeDot={{
                                    r: 6,
                                }}
                                animationDuration={0}
                                isAnimationActive={false}
                            />

                        </LineChart>

                    </ResponsiveContainer>

                </div>

            </div>


            <section className="dashboard-breakdown item-sales-section">
                <div className="item-sales-header">
                    <div>
                        <h2>Menu Items Sold</h2>
                        <p>Quantity sold and revenue for {formattedSelectedDate}.</p>
                    </div>

                    <select
                        aria-label="Filter menu items by category"
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                    >
                        <option value="ALL">All Categories</option>
                        {firebaseCategories.map((category) => (
                            <option key={category} value={category}>
                                {category}
                            </option>
                        ))}
                    </select>
                </div>

                {topItems.length > 0 ? (
                    <div className="item-sales-table-wrap">
                        <table className="item-sales-table">
                            <thead>
                                <tr>
                                    <th>Menu Item</th>
                                    <th>Category</th>
                                    <th>Quantity Sold</th>
                                    <th>Revenue</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topItems.map((item) => (
                                    <tr key={item.id}>
                                        <td>{item.name}</td>
                                        <td>{item.category || 'Uncategorized'}</td>
                                        <td>{item.qty}</td>
                                        <td>₱{item.revenue.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="item-sales-empty">
                        No items were sold in this category on the selected date.
                    </div>
                )}
            </section>


            {/* =================================================
                MENU CATEGORIES
                ================================================= */}

            <div className="dashboard-breakdown">

                <h2>
                    Menu Categories
                </h2>


                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: '16px',
                        marginTop: '20px',
                    }}
                >

                    {categoryCounts.map(
                        (cat) => (

                            <div
                                key={
                                    cat.key
                                }
                                style={{
                                    display:
                                        'flex',
                                    alignItems:
                                        'center',
                                    justifyContent:
                                        'space-between',
                                    background:
                                        'white',
                                    border:
                                        '1px solid #eaeaea',
                                    borderLeft:
                                        `6px solid ${cat.color}`,
                                    borderRadius:
                                        '8px',
                                    padding:
                                        '16px 20px',
                                    boxShadow:
                                        '0 2px 6px rgba(0,0,0,0.03)',
                                    transition:
                                        'box-shadow 0.2s ease',
                                    cursor:
                                        'default',
                                }}
                                onMouseEnter={
                                    (e) => {

                                        e.currentTarget.style.boxShadow =
                                            '0 4px 10px rgba(0,0,0,0.06)'
                                    }
                                }
                                onMouseLeave={
                                    (e) => {

                                        e.currentTarget.style.boxShadow =
                                            '0 2px 6px rgba(0,0,0,0.03)'
                                    }
                                }
                            >

                                <span
                                    style={{
                                        fontWeight:
                                            700,
                                        fontSize:
                                            '0.95em',
                                        color:
                                            '#444',
                                    }}
                                >
                                    {
                                        cat.key
                                    }
                                </span>


                                <div
                                    style={{
                                        display:
                                            'flex',
                                        flexDirection:
                                            'column',
                                        alignItems:
                                            'flex-end',
                                    }}
                                >

                                    <span
                                        style={{
                                            fontSize:
                                                '1.6em',
                                            fontWeight:
                                                800,
                                            color:
                                                '#222',
                                            lineHeight:
                                                1,
                                        }}
                                    >
                                        {
                                            cat.count
                                        }
                                    </span>


                                    <span
                                        style={{
                                            fontSize:
                                                '0.7em',
                                            fontWeight:
                                                600,
                                            color:
                                                '#aaa',
                                            textTransform:
                                                'uppercase',
                                            marginTop:
                                                '4px',
                                        }}
                                    >
                                        Items
                                    </span>

                                </div>

                            </div>

                        )
                    )}

                </div>

            </div>

        </div>
    )
}


export default Dashboard