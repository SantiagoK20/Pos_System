import { useState } from 'react'

function QuantityModal({ item, onCancel, onConfirm }) {
    const [qty, setQty] = useState(1)

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <span>{item.name}</span>
                    <button className="modal-close" onClick={onCancel}>✕</button>
                </div>

                <div className="modal-body">
                    <p className="modal-label">SELECT QUANTITY</p>
                    <div className="modal-qty-row">
                        <button className="modal-qty-btn minus" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                        <span className="modal-qty-value">{qty}</span>
                        <button className="modal-qty-btn plus" onClick={() => setQty((q) => q + 1)}>+</button>
                    </div>

                    <p className="modal-calc">
                        ₱{item.price} × {qty} = <span className="modal-total">₱{item.price * qty}</span>
                    </p>

                    <div className="modal-actions">
                        <button className="modal-cancel" onClick={onCancel}>Cancel</button>
                        <button className="modal-confirm" onClick={() => onConfirm(item, qty)}>Add to Order</button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default QuantityModal