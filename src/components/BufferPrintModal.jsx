function BufferPrintModal({ sale, onClose }) {
    if (!sale?.items?.length) return null

    // Categorize items
    const kitchenCategories = ['SHORT ORDER', 'VALUE MEALS', 'RICE', 'PULUTAN']
    const dessertCategories = ['REFRESHMENT', 'DRINKS', 'OTHERS']

    const kitchenItems = sale.items.filter((i) => kitchenCategories.includes(i.category))
    const dessertItems = sale.items.filter((i) => dessertCategories.includes(i.category) || !kitchenCategories.includes(i.category))

    const ticketDate = new Date(sale.date)

    const handlePrintStation = async (stationId) => {
        const printContent = document.getElementById(stationId)
        if (!printContent) {
            window.print()
            return
        }

        const html = `
            <html>
                <head>
                    <title>Buffer Print - ${stationId.toUpperCase()}</title>
                    <style>
                        body { font-family: 'Courier New', Courier, monospace; font-size: 14px; margin: 10px; }
                        h2 { margin: 0 0 4px; text-align: center; font-size: 18px; }
                        p { margin: 2px 0; text-align: center; }
                        .line { border-bottom: 1px dashed #000; margin: 8px 0; }
                        .item { display: flex; justify-content: space-between; margin: 4px 0; font-size: 16px; font-weight: bold; }
                    </style>
                </head>
                <body>
                    ${printContent.innerHTML}
                </body>
            </html>
        `

        if (window.posPrinter) {
            try {
                await window.posPrinter.printHtml(html)
            } catch (error) {
                console.error('Failed to print buffer slip:', error)
                alert(`Failed to print buffer slip: ${error.message}`)
            }
            return
        }

        const windowUrl = 'about:blank'
        const uniqueName = new Date().getTime()
        const printWindow = window.open(windowUrl, uniqueName, 'left=100,top=100,width=400,height=600')

        if (printWindow) {
            printWindow.document.write(html)
            printWindow.document.close()
            printWindow.focus()
            printWindow.print()
            printWindow.close()
        } else {
            window.print()
        }
    }

    return (
        <div className="receipt-overlay">
            <div className="receipt-modal" style={{ maxWidth: '650px', width: '90%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '2px solid #1b7a3d', paddingBottom: '10px' }}>
                    <h2 style={{ margin: 0, color: '#1b7a3d', fontSize: '1.4em' }}>🖨️ KITCHEN & DESSERT BUFFER PRINT</h2>
                    <button className="modal-close" onClick={onClose} style={{ color: '#333', fontSize: '1.2em', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '5px' }}>
                    
                    {/* KITCHEN TICKET */}
                    <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: '8px', padding: '16px' }}>
                        <div id="kitchen-ticket">
                            <h2 style={{ textAlign: 'center', margin: '0 0 4px', fontSize: '1.2em', color: '#d48806' }}>🔥 KITCHEN SLIP</h2>
                            <p style={{ textTransform: 'uppercase', fontWeight: 600, fontSize: '0.8em', color: '#666', textAlign: 'center', margin: '0 0 8px' }}>Prep Station: Kitchen Area</p>
                            <p style={{ fontSize: '0.75em', color: '#666', textAlign: 'center' }}>Transaction: {sale.id} | {sale.orderType === 'take_out' ? 'TAKE OUT' : 'DINE IN'}</p>
                            <p style={{ fontSize: '0.75em', color: '#888', textAlign: 'center' }}>Time: {ticketDate.toLocaleTimeString()} | Date: {ticketDate.toLocaleDateString()}</p>
                            <div style={{ borderBottom: '1px dashed #ccc', margin: '10px 0' }}></div>
                            
                            {kitchenItems.length > 0 ? (
                                kitchenItems.map((item) => (
                                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1em', fontWeight: 700, margin: '8px 0', color: '#222' }}>
                                        <span>{item.name}</span>
                                        <span style={{ color: '#d48806' }}>QTY: {item.qty}</span>
                                    </div>
                                ))
                            ) : (
                                <p style={{ textAlign: 'center', color: '#aaa', fontStyle: 'italic', margin: '20px 0' }}>No kitchen items in current order</p>
                            )}
                        </div>

                        {kitchenItems.length > 0 && (
                            <button
                                className="action-btn"
                                onClick={() => handlePrintStation('kitchen-ticket')}
                                style={{ width: '100%', marginTop: '16px', background: '#faad14', color: '#fff', padding: '10px', fontSize: '0.9em', borderRadius: '6px', fontWeight: 700, border: 'none', cursor: 'pointer' }}
                            >
                                🖨️ PRINT KITCHEN SLIP
                            </button>
                        )}
                    </div>

                    {/* DESSERT & DRINKS TICKET */}
                    <div style={{ background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: '8px', padding: '16px' }}>
                        <div id="dessert-ticket">
                            <h2 style={{ textAlign: 'center', margin: '0 0 4px', fontSize: '1.2em', color: '#096dd9' }}>🍧 DESSERT & BAR SLIP</h2>
                            <p style={{ textTransform: 'uppercase', fontWeight: 600, fontSize: '0.8em', color: '#666', textAlign: 'center', margin: '0 0 8px' }}>Prep Station: Dessert & Beverage Area</p>
                            <p style={{ fontSize: '0.75em', color: '#666', textAlign: 'center' }}>Transaction: {sale.id} | {sale.orderType === 'take_out' ? 'TAKE OUT' : 'DINE IN'}</p>
                            <p style={{ fontSize: '0.75em', color: '#888', textAlign: 'center' }}>Time: {ticketDate.toLocaleTimeString()} | Date: {ticketDate.toLocaleDateString()}</p>
                            <div style={{ borderBottom: '1px dashed #ccc', margin: '10px 0' }}></div>

                            {dessertItems.length > 0 ? (
                                dessertItems.map((item) => (
                                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1em', fontWeight: 700, margin: '8px 0', color: '#222' }}>
                                        <span>{item.name}</span>
                                        <span style={{ color: '#096dd9' }}>QTY: {item.qty}</span>
                                    </div>
                                ))
                            ) : (
                                <p style={{ textAlign: 'center', color: '#aaa', fontStyle: 'italic', margin: '20px 0' }}>No dessert/drink items in current order</p>
                            )}
                        </div>

                        {dessertItems.length > 0 && (
                            <button
                                className="action-btn"
                                onClick={() => handlePrintStation('dessert-ticket')}
                                style={{ width: '100%', marginTop: '16px', background: '#1890ff', color: '#fff', padding: '10px', fontSize: '0.9em', borderRadius: '6px', fontWeight: 700, border: 'none', cursor: 'pointer' }}
                            >
                                🖨️ PRINT DESSERT SLIP
                            </button>
                        )}
                    </div>

                </div>

                <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button
                        onClick={onClose}
                        style={{ padding: '10px 20px', background: '#eee', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    )
}

export default BufferPrintModal
