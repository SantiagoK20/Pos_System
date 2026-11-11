function CashierShiftReceipt({ cashier, shift, date, sales, onClose }) {
    if (!cashier) return null

    const total = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
    const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString()

    async function handlePrint() {
        try {
            if (window.posPrinter) {
                await window.posPrinter.printCurrent()
            } else {
                window.print()
            }
        } catch (error) {
            console.error('Failed to print shift receipt:', error)
            alert(`Failed to print shift receipt: ${error.message}`)
        }
    }

    function getSaleTime(sale) {
        const rawDate = sale.date || sale.createdAt || sale.created_at || sale.timestamp
        if (!rawDate) return 'Time unavailable'

        const timestamp = typeof rawDate === 'number' && rawDate < 10000000000
            ? rawDate * 1000
            : rawDate
        const saleDate = new Date(timestamp)

        return Number.isNaN(saleDate.getTime())
            ? 'Time unavailable'
            : saleDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    return (
        <div className="receipt-overlay">
            <div className="receipt-modal">
                <div className="receipt">
                    <div className="receipt-header">
                        <h1>ATECLES GRILL</h1>
                        <p>CASHIER SHIFT SUMMARY</p>
                        <p>--------------------------------</p>
                    </div>

                    <div className="receipt-info">
                        <p><strong>Cashier:</strong> {cashier.cashierUsername}</p>
                        <p><strong>Shift:</strong> {shift || 'Unassigned'}</p>
                        <p><strong>Date:</strong> {formattedDate}</p>
                        <p><strong>Transactions:</strong> {sales.length}</p>
                    </div>

                    <p>--------------------------------</p>

                    <div className="receipt-items">
                        {sales.map((sale, index) => (
                            <div className="receipt-item" key={sale.id ?? index}>
                                <div className="receipt-item-name">
                                    Receipt {sale.id ?? index + 1}
                                </div>
                                <div className="receipt-item-details">
                                    <span>{getSaleTime(sale)}</span>
                                    <span>₱{Number(sale.total || 0).toFixed(2)}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <p>--------------------------------</p>

                    <div className="receipt-totals">
                        <div className="receipt-total">
                            <strong>SHIFT TOTAL</strong>
                            <strong>₱{total.toFixed(2)}</strong>
                        </div>
                    </div>

                    <div className="receipt-footer">
                        <p>End of shift sales summary</p>
                        <p>Atecles Grill</p>
                    </div>
                </div>

                <div className="receipt-buttons">
                    <button className="receipt-print-btn" onClick={handlePrint}>
                        PRINT SHIFT RECEIPT
                    </button>
                    <button className="receipt-close-btn" onClick={onClose}>
                        CLOSE
                    </button>
                </div>
            </div>
        </div>
    )
}

export default CashierShiftReceipt
