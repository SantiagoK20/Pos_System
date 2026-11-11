function Receipt({ sale, onClose }) {
    if (!sale) return null

    const receiptDate = new Date(sale.date)

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

                {/* Receipt */}
                <div className="receipt" id="receipt">

                    <div className="receipt-header">
                        <h1>ATECLES GRILL</h1>
                        <p>POINT OF SALE RECEIPT</p>
                        <p>--------------------------------</p>
                    </div>

                    <div className="receipt-info">
                        <p>
                            <strong>Transaction:</strong> {sale.id}
                        </p>
                        <p>
                            <strong>Order Type:</strong>{' '}
                            {sale.orderType === 'take_out' ? 'TAKE OUT' : 'DINE IN'}
                        </p>
                        <p>
                            <strong>Date:</strong>{' '}
                            {receiptDate.toLocaleDateString()}
                        </p>
                        <p>
                            <strong>Time:</strong>{' '}
                            {receiptDate.toLocaleTimeString()}
                        </p>
                        {(sale.cashierUsername || sale.cashierId) && (
                            <p>
                                <strong>Cashier:</strong> {sale.cashierUsername || sale.cashierId}
                            </p>
                        )}
                        {sale.shift && (
                            <p>
                                <strong>Shift:</strong> {sale.shift}
                            </p>
                        )}
                    </div>

                    <p>--------------------------------</p>

                    {/* Items */}
                    <div className="receipt-items">

                        {sale.items.map((item) => (
                            <div className="receipt-item" key={item.id}>

                                <div className="receipt-item-name">
                                    {item.name}
                                </div>

                                <div className="receipt-item-details">
                                    <span>
                                        {item.qty} × ₱{item.price.toFixed(2)}
                                    </span>

                                    <span>
                                        ₱{(item.qty * item.price).toFixed(2)}
                                    </span>
                                </div>

                            </div>
                        ))}

                    </div>

                    <p>--------------------------------</p>

                    {/* Totals */}
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

                    <p>--------------------------------</p>

                    {/* Payment */}
                    <div className="receipt-payment">

                        <div>
                            <span>Payment</span>
                            <span>
                                {sale.paymentMethod === 'cash'
                                    ? 'CASH'
                                    : 'E-WALLET'}
                            </span>
                        </div>

                        {sale.paymentMethod === 'cash' && (
                            <>
                                <div>
                                    <span>Tendered</span>
                                    <span>
                                        ₱{Number(sale.tendered).toFixed(2)}
                                    </span>
                                </div>

                                <div>
                                    <span>Change</span>
                                    <span>
                                        ₱{Number(sale.change).toFixed(2)}
                                    </span>
                                </div>
                            </>
                        )}

                    </div>

                    <p>--------------------------------</p>

                    <div className="receipt-footer">
                        <p>Thank you for dining with us!</p>
                        <p>Please come again.</p>
                        <p>Atecles Grill</p>
                    </div>

                </div>

                {/* Buttons */}
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