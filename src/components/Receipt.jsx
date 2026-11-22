import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getOrderTypeLabel } from '../orderType'
import './SaleReceipt.css'
import receiptStyles from './SaleReceipt.css?raw'

function Receipt({ sale, onClose, onPrinted }) {
    const receiptRef = useRef(null)
    const [paperWidth, setPaperWidth] = useState(() =>
        localStorage.getItem('saleReceiptPaperWidth') === '58' ? '58' : '80'
    )

    if (!sale) return null

    const receiptDate = new Date(sale.date)
    const itemCount = sale.items.reduce((count, item) => count + item.qty, 0)

    async function handlePrint() {
        try {
            if (window.posPrinter) {
                await window.posPrinter.printHtml(
                    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Sales Receipt</title>
                    <style>body { margin: 0 } ${receiptStyles}</style><body>
                    ${receiptRef.current.outerHTML}</body></html>`
                )
            } else {
                window.print()
            }
            onPrinted?.()
        } catch (error) {
            console.error('Failed to print receipt:', error)
            alert(`Failed to print receipt: ${error.message}`)
        }
    }

    return createPortal(
        <div className="receipt-overlay sale-receipt-overlay">
            <div className="receipt-modal">
                <div ref={receiptRef} className="sale-receipt" data-paper-width={paperWidth}>
                    <div className="receipt-header">
                        <h1>ATECLES GRILL</h1>
                        <p>SALES RECEIPT</p>
                    </div>

                    <div className="receipt-info">
                        <p>Order Type: <strong>{getOrderTypeLabel(sale.orderType) || 'Not recorded'}</strong></p>
                    </div>

                    <div className="sale-receipt-divider" />
                    <div className="receipt-items">
                        {sale.items.map((item) => (
                            <div className="receipt-item" key={item.id}>
                                <div className="sale-receipt-line">
                                    <span className="sale-receipt-item-name">{item.name}</span>
                                    <span>₱{(item.qty * item.price).toFixed(2)}</span>
                                </div>
                                {item.qty !== 1 && (
                                    <div>{item.qty} × ₱{item.price.toFixed(2)}</div>
                                )}
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
                        <div className="sale-receipt-payment-amount">
                            <strong>{sale.paymentMethod === 'cash' ? 'CASH' : 'E-WALLET'}</strong>
                            <strong>₱{Number(sale.tendered).toFixed(2)}</strong>
                        </div>

                        {sale.paymentMethod === 'cash' && (
                            <>
                                <div className="sale-receipt-payment-amount">
                                    <strong>CHANGE</strong>
                                    <strong>₱{Number(sale.change).toFixed(2)}</strong>
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

                    <div className="sale-receipt-customer">
                        {['Customer', 'Address', 'TIN', 'Business Style', 'OSCA/PWD ID', 'Signature'].map((field) => (
                            <div key={field}><span>{field}</span><span /></div>
                        ))}
                    </div>

                    <div className="receipt-footer">
                        <p>Thank you for dining with us!</p>
                        <p>Please come again.</p>
                    </div>
                </div>

                <label className="sale-receipt-paper">
                    Paper width{' '}
                    <select value={paperWidth} onChange={(event) => {
                        const width = event.target.value
                        setPaperWidth(width)
                        localStorage.setItem('saleReceiptPaperWidth', width)
                    }}>
                        <option value="80">80 mm</option>
                        <option value="58">58 mm</option>
                    </select>
                </label>
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
        </div>,
        document.body
    )
}

export default Receipt
