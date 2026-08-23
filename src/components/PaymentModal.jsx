import { useState } from 'react'

function PaymentModal({ total, onCancel, onConfirm }) {
    const [method, setMethod] = useState('cash')
    const [amountStr, setAmountStr] = useState('')

    const tendered = parseFloat(amountStr) || 0
    const change = tendered - total
    const canConfirmCash = tendered >= total

    function pressDigit(d) {
        if (d === '.' && amountStr.includes('.')) return
        // limit to 2 decimal places
        if (amountStr.includes('.')) {
            const decimals = amountStr.split('.')[1]
            if (decimals && decimals.length >= 2) return
        }
        setAmountStr((prev) => prev + d)
    }

    function backspace() {
        setAmountStr((prev) => prev.slice(0, -1))
    }

    function clearAmount() {
        setAmountStr('')
    }

    function quickAmount(val) {
        setAmountStr(String(val))
    }

    function handleConfirm() {
        if (method === 'cash') {
            if (!canConfirmCash) {
                alert('Amount received is less than the total.')
                return
            }
            onConfirm({ method: 'cash', tendered, change })
        } else {
            onConfirm({ method: 'ewallet', tendered: total, change: 0 })
        }
    }

    const quickAmounts = [total, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500]
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .slice(0, 4)

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-box payment-box" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <span>Payment</span>
                    <button className="modal-close" onClick={onCancel}>✕</button>
                </div>

                <div className="modal-body">
                    <p className="modal-label">TOTAL DUE</p>
                    <p className="payment-total">₱{total.toFixed(2)}</p>

                    <div className="payment-method-tabs">
                        <button
                            className={`payment-tab ${method === 'cash' ? 'active' : ''}`}
                            onClick={() => setMethod('cash')}
                        >
                            💵 Cash
                        </button>
                        <button
                            className={`payment-tab ${method === 'ewallet' ? 'active' : ''}`}
                            onClick={() => setMethod('ewallet')}
                        >
                            📱 E-Wallet
                        </button>
                    </div>

                    {method === 'cash' ? (
                        <>
                            <label className="payment-input-label">AMOUNT RECEIVED</label>
                            <div className="payment-display">
                                ₱{amountStr || '0'}
                            </div>

                            <div className="quick-amount-row">
                                {quickAmounts.map((val) => (
                                    <button key={val} className="quick-amount-btn" onClick={() => quickAmount(val)}>
                                        ₱{val}
                                    </button>
                                ))}
                            </div>

                            <div className="onscreen-keypad">
                                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => (
                                    <button
                                        key={k}
                                        className="onscreen-key"
                                        onClick={() => (k === '⌫' ? backspace() : pressDigit(k))}
                                    >
                                        {k}
                                    </button>
                                ))}
                            </div>

                            <button className="clear-amount-btn" onClick={clearAmount}>Clear</button>

                            <div className="payment-change-row">
                                <span>Change</span>
                                <span className={change < 0 ? 'change-negative' : 'change-positive'}>
                                    ₱{amountStr ? change.toFixed(2) : '0.00'}
                                </span>
                            </div>
                        </>
                    ) : (
                        <p className="ewallet-note">
                            Confirm once payment is received via GCash, Maya, or other e-wallet.
                        </p>
                    )}

                    <div className="modal-actions">
                        <button className="modal-cancel" onClick={onCancel}>Cancel</button>
                        <button
                            className="modal-confirm"
                            onClick={handleConfirm}
                            disabled={method === 'cash' && !canConfirmCash}
                        >
                            Confirm Payment
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default PaymentModal