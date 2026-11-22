export function getOrderTypeLabel(orderType) {
  if (typeof orderType !== 'string') return ''
  const type = orderType.trim().toLowerCase().replace(/[- ]/g, '_')
  if (type === 'dine_in') return 'DINE IN'
  if (type === 'take_out') return 'TAKE OUT'
  return ''
}
