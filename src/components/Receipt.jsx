function Receipt({ sale, onClose }) {
    if (!sale) return null

    const receiptDate = new Date(sale.date)
    const itemCount = sale.items.reduce((count, item) => count + item.qty, 0)

    async function handlePrint() {
        try {
            if (window.posPrinter) {
                await window.posPrinter.printCurrent()
            } else {
                window.print()
            }
        } catch (error) {
            console.error('Failed to print receipt:', error)
            alert(`Failed to print receipt: ${error.message}`)
        }
    }

    return (
        <div className="receipt-overlay">
            <div className="receipt-modal">
                <div className="receipt sale-receipt" id="receipt">
                    <div className="receipt-header">
                        <h1>ATECLES GRILL</h1>
                        <p>SALES RECEIPT</p>
                    </div>

                    <div className="receipt-info">
                        <p>Order: {sale.orderType === 'take_out' ? 'TAKE OUT' : 'DINE IN'}</p>
                    </div>

                    <div className="sale-receipt-divider" />
                    <div className="receipt-items">
                        {sale.items.map((item) => (
                            <div className="receipt-item" key={item.id}>
                                <div className="receipt-item-name">
                                    {item.name}
                                </div>
                                <div className="receipt-item-details">
                                    <span>{item.qty} × ₱{item.price.toFixed(2)}</span>
                                    <span>₱{(item.qty * item.price).toFixed(2)}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="sale-receipt-divider" />
                    <div className="receipt-totals">
                        <div>
                            <span>Subtotal</span>
                            <span>₱{sale.subtotal.toFixed(2)}</span>
                        </div>

                        {sale.discount && (
                            <div>
                                <span>
                                    Discount
                                    {sale.discount.type === 'percent'
                                        ? ` (${sale.discount.value}%)`
                                        : ''}
                                </span>
                                <span>
                                    -₱{sale.discountValue.toFixed(2)}
                                </span>
                            </div>
                        )}

                        <div>
                            <span>VAT (12%)</span>
                            <span>₱{sale.vat.toFixed(2)}</span>
                        </div>

                        <div className="receipt-total">
                            <strong>TOTAL</strong>
                            <strong>₱{sale.total.toFixed(2)}</strong>
                        </div>
                    </div>

                    <div className="sale-receipt-divider" />
                    <div className="receipt-payment">
                        <div>
                            <strong>{sale.paymentMethod === 'cash' ? 'CASH' : 'E-WALLET'}</strong>
                            <strong>₱{Number(sale.tendered).toFixed(2)}</strong>
                        </div>

                        {sale.paymentMethod === 'cash' && (
                            <>
                                <div>
                                    <span>Change</span>
                                    <span>₱{Number(sale.change).toFixed(2)}</span>
                                </div>
                            </>
                        )}
                        <div>
                            <span>Item Count</span>
                            <span>{itemCount}</span>
                        </div>
                    </div>

                    <div className="sale-receipt-divider" />
                    <div className="receipt-info sale-receipt-meta">
                        <p>{sale.cashierUsername || sale.cashierId || 'Cashier'}</p>
                        <p>{receiptDate.toLocaleString()}</p>
                        <p>Transaction: {sale.id}</p>
                    </div>

                    <div className="receipt-footer">
                        <p>Thank you for dining with us!</p>
                        <p>Please come again.</p>
                    </div>
                </div>

                <div className="receipt-buttons">
                    <button
                        className="receipt-print-btn"
                        onClick={handlePrint}
                    >
                        🖨️ PRINT RECEIPT
                    </button>

                    <button
                        className="receipt-close-btn"
                        onClick={onClose}
                    >
                        CLOSE
                    </button>
                </div>

            </div>
        </div>
    )
}

export default Receipt