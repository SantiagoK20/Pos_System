
import { useRef, useState } from 'react'
import { CATEGORIES, TAX_RATE } from '../data/menuData'
import QuantityModal from './QuantityModal'
import PaymentModal from './PaymentModal'
import Receipt from './Receipt'

function createSaleIdentity() {
    return {
        id: Date.now(),
        clientSaleId: crypto.randomUUID(),
    }
}

function POSScreen({ menuItems, cashierId, cashierUsername, cashierShift, onCompleteSale, onAuditEvent }) {
    const [activeCategory, setActiveCategory] = useState('SHORT ORDER')
    const [cart, setCart] = useState([])
    const [modalItem, setModalItem] = useState(null)
    const [showPayment, setShowPayment] = useState(false)
    const [completedSale, setCompletedSale] = useState(null)
    const [pendingSale, setPendingSale] = useState(null)

    const paymentInProgress = useRef(false)

    // Numpad input
    const [numpadValue, setNumpadValue] = useState('')

    // Discount state
    const [discount, setDiscount] = useState(null)

    const itemsInCategory = menuItems.filter((i) => i.category === activeCategory)

    function confirmAddToCart(item, qty) {
        setCart((prev) => {
            const existing = prev.find((c) => c.id === item.id)

            if (existing) {
                return prev.map((c) =>
                    c.id === item.id ? { ...c, qty: c.qty + qty } : c
                )
            }

            return [...prev, { ...item, qty }]
        })

        setModalItem(null)
    }

    function changeQty(id, delta) {
        setCart((prev) =>
            prev
                .map((c) => (c.id === id ? { ...c, qty: c.qty + delta } : c))
                .filter((c) => c.qty > 0)
        )
    }

    function clearCart() {
        setCart([])
        setDiscount(null)
        setNumpadValue('')
    }

    function handleVoid() {
        if (cart.length === 0) return

        if (confirm('Void the current order? This will clear all items.')) {
            clearCart()
        }
    }

    // ---- Numpad ----
    function pressNumpad(val) {
        setNumpadValue((prev) => {
            if (val === '00') return prev + '00'
            return prev + val
        })
    }

    function clearNumpad() {
        setNumpadValue('')
    }

    // ---- Discounts ----
    function applyPercentDiscount() {
        const val = parseFloat(numpadValue)

        if (!val || val <= 0) {
            alert('Type a number on the keypad first, then tap % DISC.')
            return
        }

        if (val > 100) {
            alert('Percentage discount cannot exceed 100%.')
            return
        }

        setDiscount({ type: 'percent', value: val })
        setNumpadValue('')
    }

    function applyAmountDiscount() {
        const val = parseFloat(numpadValue)

        if (!val || val <= 0) {
            alert('Type a number on the keypad first, then tap AMOUNT DISC.')
            return
        }

        setDiscount({ type: 'amount', value: val })
        setNumpadValue('')
    }

    function removeDiscount() {
        setDiscount(null)
    }

    // ---- Totals ----
    const subtotal = cart.reduce(
        (sum, item) => sum + item.price * item.qty,
        0
    )

    let discountValue = 0

    if (discount) {
        discountValue =
            discount.type === 'percent'
                ? subtotal * (discount.value / 100)
                : discount.value

        discountValue = Math.min(discountValue, subtotal)
    }

    const discountedSubtotal = subtotal - discountValue
    const vat = discountedSubtotal * TAX_RATE
    const total = discountedSubtotal + vat
    const itemCount = cart.reduce((sum, item) => sum + item.qty, 0)

    function openPayment() {
        if (cart.length === 0) {
            alert('No items in the order!')
            return
        }

        setShowPayment(true)
    }

    // ---- Payment and Sale Processing ----
    async function handlePaymentConfirm({ method, tendered, change, orderType }) {
        if (paymentInProgress.current) return

        paymentInProgress.current = true

        let sale = pendingSale

        if (!sale) {
            sale = {
                ...createSaleIdentity(),
                date: new Date().toISOString(),
                cashierId,
                cashierUsername,
                shift: cashierShift,
                items: cart.map((c) => ({
                    id: c.id,
                    name: c.name,
                    category: c.category,
                    price: c.price,
                    qty: c.qty,
                })),
                subtotal,
                discount,
                discountValue,
                vat,
                total,
                paymentMethod: method,
                orderType,
                tendered,
                change,
            }

            setPendingSale(sale)
        }

        try {
            const result = await onCompleteSale(sale)

            if (
                result?.status !== 'saved' &&
                result?.status !== 'queued'
            ) {
                alert(
                    result?.message ||
                    'The sale could not be saved. Your cart has been preserved.'
                )
                return
            }

            const receiptSale = {
                ...sale,
                syncStatus: result.status === 'queued' ? 'pending' : 'synced',
            }

            setCompletedSale(receiptSale)
            setPendingSale(null)
            setShowPayment(false)
            clearCart()

            if (result.status === 'queued') {
                alert(
                    'Internet connection unavailable. The sale was saved locally and is waiting to sync.'
                )
            }
        } catch (error) {
            console.error('Checkout failed:', error)

            alert(
                'The sale could not be completed. Your cart has been preserved.'
            )
        } finally {
            paymentInProgress.current = false
        }
    }

    return (
        <div className="pos-page fade-in">
            <div className="order-panel">
                <div className="order-header">
                    <span>🛒 CURRENT ORDER</span>
                    <span className="order-count">{itemCount}</span>
                </div>

                <div className="order-subtotal-row">
                    <span>SUBTOTAL</span>
                    <span>₱{subtotal.toFixed(2)}</span>
                </div>

                <div className="order-list-header">
                    <span>ITEM</span>
                    <span>QTY</span>
                    <span>PRICE</span>
                    <span>AMT</span>
                </div>

                <div className="order-list">
                    {cart.length === 0 && (
                        <div className="empty-order">
                            <div className="empty-cart-icon">🛒</div>
                            <p>No items</p>
                        </div>
                    )}

                    {cart.map((item) => (
                        <div key={item.id} className="order-line">
                            <span className="line-name">{item.name}</span>

                            <span className="line-qty">
                                <button onClick={() => changeQty(item.id, -1)}>
                                    -
                                </button>

                                {item.qty}

                                <button onClick={() => changeQty(item.id, 1)}>
                                    +
                                </button>
                            </span>

                            <span>₱{item.price.toFixed(2)}</span>
                            <span>₱{(item.price * item.qty).toFixed(2)}</span>
                        </div>
                    ))}
                </div>

                <div className="order-totals">
                    <div className="totals-row">
                        <span>Subtotal</span>
                        <span>₱{subtotal.toFixed(2)}</span>
                    </div>

                    {discount && (
                        <div className="totals-row discount-row">
                            <span>
                                Discount (
                                {discount.type === 'percent'
                                    ? `${discount.value}%`
                                    : `₱${discount.value}`}
                                )

                                <button
                                    className="remove-discount-btn"
                                    onClick={removeDiscount}
                                >
                                    ✕
                                </button>
                            </span>

                            <span>-₱{discountValue.toFixed(2)}</span>
                        </div>
                    )}

                    <div className="totals-row">
                        <span>VAT 12%</span>
                        <span>₱{vat.toFixed(2)}</span>
                    </div>

                    <div className="totals-row grand-total">
                        <span>TOTAL</span>
                        <span>₱{total.toFixed(2)}</span>
                    </div>
                </div>

                {/* Numpad input display */}
                <div className="numpad-display-row">
                    <span>Keypad Entry</span>
                    <span className="numpad-display-value">
                        {numpadValue || '0'}
                    </span>
                </div>

                <div className="keypad">
                    <button className="key" onClick={() => pressNumpad('7')}>7</button>
                    <button className="key" onClick={() => pressNumpad('8')}>8</button>
                    <button className="key" onClick={() => pressNumpad('9')}>9</button>
                    <button className="key up" onClick={clearNumpad}>CLR</button>

                    <button className="key" onClick={() => pressNumpad('4')}>4</button>
                    <button className="key" onClick={() => pressNumpad('5')}>5</button>
                    <button className="key" onClick={() => pressNumpad('6')}>6</button>

                    <button
                        className="key down"
                        onClick={() =>
                            setNumpadValue((prev) => prev.slice(0, -1))
                        }
                    >
                        ⌫
                    </button>

                    <button className="key" onClick={() => pressNumpad('1')}>1</button>
                    <button className="key" onClick={() => pressNumpad('2')}>2</button>
                    <button className="key" onClick={() => pressNumpad('3')}>3</button>
                    <button className="key pay" onClick={openPayment}>TOTAL / PAY</button>

                    <button className="key wide" onClick={() => pressNumpad('0')}>0</button>
                    <button className="key" onClick={() => pressNumpad('00')}>00</button>
                </div>

                <div className="action-row">
                    <button
                        className="action-btn"
                        onClick={applyAmountDiscount}
                    >
                        AMOUNT DISC.
                    </button>

                    <button
                        className="action-btn disc"
                        onClick={applyPercentDiscount}
                    >
                        % DISC.
                    </button>

                    <button className="action-btn void" onClick={handleVoid}>VOID</button>
                </div>
            </div>

            <div className="menu-panel">
                <div className="menu-body">
                    <div className="menu-grid">
                        {itemsInCategory.map((item) => (
                            <button
                                key={item.id}
                                className="menu-item"
                                onClick={() => setModalItem(item)}
                            >
                                <span>{item.name}</span>
                                <span className="menu-item-price">
                                    ₱{item.price}
                                </span>
                            </button>
                        ))}

                        {itemsInCategory.length === 0 && (
                            <p style={{ color: '#666', gridColumn: '1/-1' }}>
                                No items in this category yet.
                            </p>
                        )}
                    </div>

                    <div className="category-tabs">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat.key}
                                className={`category-tab ${activeCategory === cat.key ? 'active' : ''}`}
                                style={{ background: cat.color }}
                                onClick={() => setActiveCategory(cat.key)}
                            >
                                {cat.key}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="menu-footer">
                    <span>{activeCategory}</span>
                    <span>Ready</span>
                </div>
            </div>

            {modalItem && (
                <QuantityModal
                    item={modalItem}
                    onCancel={() => setModalItem(null)}
                    onConfirm={confirmAddToCart}
                />
            )}

            {showPayment && (
                <PaymentModal
                    total={total}
                    onCancel={() => {
                        setShowPayment(false)
                        setPendingSale(null)
                    }}
                    onConfirm={handlePaymentConfirm}
                />
            )}

            {/* Receipt */}
            <Receipt
                sale={completedSale}
                onPrinted={() =>
                    onAuditEvent('receipt_printed', {
                        receiptType: 'sale',
                        targetId: String(completedSale.id),
                    })
                }
                onClose={() => setCompletedSale(null)}
            />
   </div>
    )
}

export default POSScreen
