import { useState } from 'react'
import { CATEGORIES } from '../data/menuData'

function ManageMenu({ menuItems, onAdd, onEdit, onDelete }) {
    const [filter, setFilter] = useState('ALL')
    const [searchTerm, setSearchTerm] = useState('')
    const [editingItem, setEditingItem] = useState(null)
    const [showAddForm, setShowAddForm] = useState(false)
    const [form, setForm] = useState({ name: '', price: '', category: CATEGORIES[0].key })

    const normalizedSearch = searchTerm.trim().toLowerCase()

    const filtered = menuItems.filter((item) => {
        const matchesCategory = filter === 'ALL' ? true : item.category === filter
        const matchesSearch = !normalizedSearch || (item.name || '').toLowerCase().includes(normalizedSearch)
        return matchesCategory && matchesSearch
    })

    function openAddForm() {
        setForm({ name: '', price: '', category: CATEGORIES[0].key })
        setEditingItem(null)
        setShowAddForm(true)
    }

    function openEditForm(item) {
        setForm({ name: item.name, price: item.price, category: item.category })
        setEditingItem(item)
        setShowAddForm(true)
    }

    function handleSubmit(e) {
        e.preventDefault()
        if (!form.name.trim() || !form.price) {
            alert('Please fill in item name and price')
            return
        }
        if (editingItem) {
            onEdit(editingItem.id, { ...form, price: Number(form.price) })
        } else {
            onAdd({ ...form, price: Number(form.price) })
        }
        setShowAddForm(false)
    }

    function handleDelete(item) {
        if (confirm(`Delete "${item.name}"?`)) {
            onDelete(item.id)
        }
    }

    return (
        <div className="manage-menu-page">
            <div className="manage-menu-toolbar">
                <label>FILTER BY CATEGORY:</label>
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                    <option value="ALL">All ({menuItems.length})</option>
                    {CATEGORIES.map((cat) => (
                        <option key={cat.key} value={cat.key}>
                            {cat.key} ({menuItems.filter((i) => i.category === cat.key).length})
                        </option>
                    ))}
                </select>

                <input
                    type="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search items"
                    className="manage-menu-search"
                    aria-label="Search menu items"
                />

                <button className="add-item-btn" onClick={openAddForm}>+ Add Menu Item</button>
            </div>

            <div className="manage-menu-table-wrap">
                <div className="manage-menu-table-header">
                    <span>MENU ITEMS</span>
                    <span>{filtered.length} items</span>
                </div>

                <table className="manage-menu-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>ITEM NAME</th>
                            <th>CATEGORY</th>
                            <th>PRICE</th>
                            <th>ACTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((item, idx) => (
                            <tr key={item.id}>
                                <td>{idx + 1}</td>
                                <td>{item.name}</td>
                                <td>
                                    <span className="category-pill">{item.category}</span>
                                </td>
                                <td>₱{item.price}</td>
                                <td>
                                    <button className="edit-btn" onClick={() => openEditForm(item)}>Edit</button>
                                    <button className="delete-btn" onClick={() => handleDelete(item)}>Delete</button>
                                </td>
                            </tr>
                        ))}
                        {filtered.length === 0 && (
                            <tr><td colSpan={5} style={{ textAlign: 'center', color: '#888' }}>No items found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {showAddForm && (
                <div className="modal-overlay" onClick={() => setShowAddForm(false)}>
                    <div className="modal-box" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <span>{editingItem ? 'Edit Item' : 'Add Menu Item'}</span>
                            <button className="modal-close" onClick={() => setShowAddForm(false)}>✕</button>
                        </div>
                        <form className="menu-form" onSubmit={handleSubmit}>
                            <label>Item Name</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                            />

                            <label>Price (₱)</label>
                            <input
                                type="number"
                                value={form.price}
                                onChange={(e) => setForm({ ...form, price: e.target.value })}
                            />

                            <label>Category</label>
                            <select
                                value={form.category}
                                onChange={(e) => setForm({ ...form, category: e.target.value })}
                            >
                                {CATEGORIES.map((cat) => (
                                    <option key={cat.key} value={cat.key}>{cat.key}</option>
                                ))}
                            </select>

                            <div className="modal-actions">
                                <button type="button" className="modal-cancel" onClick={() => setShowAddForm(false)}>Cancel</button>
                                <button type="submit" className="modal-confirm">{editingItem ? 'Save Changes' : 'Add Item'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default ManageMenu