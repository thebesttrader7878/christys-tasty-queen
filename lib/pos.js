// POS adapters, server side. All STUBS: no network calls, no keys. Fill in once we know her POS.
const toLines = o => o.items.map(i => ({ name: i.name, qty: i.qty, unitCents: Math.round(i.unit * 100), mods: i.mods || [], note: i.note || '' }));
const note = l => [l.mods.join(', '), l.note].filter(Boolean).join(' | ');
const ADAPTERS = {
  none: { label: 'No POS (orders show in this dashboard + email)', map: null },
  // Square Orders API POST /v2/orders
  square: { label: 'Square (stub)', map: o => ({ idempotency_key: o.id, order: { location_id: 'LOCATION_ID_TBD', reference_id: o.id, line_items: toLines(o).map(l => ({ name: l.name, quantity: String(l.qty), base_price_money: { amount: l.unitCents, currency: 'USD' }, note: note(l) })), fulfillments: [{ type: 'PICKUP', state: 'PROPOSED' }] } }) },
  // Clover Atomic Order API
  clover: { label: 'Clover (stub)', map: o => ({ orderCart: { title: 'Online #' + o.id, note: o.notes || '', lineItems: toLines(o).flatMap(l => Array(l.qty).fill({ name: l.name, price: l.unitCents, note: note(l) })) } }) },
  // Toast Orders API (needs partner access + menu GUIDs)
  toast: { label: 'Toast (stub)', map: o => ({ entityType: 'Order', externalId: o.id, checks: [{ selections: toLines(o).map(l => ({ item: { guid: 'MENU_ITEM_GUID_TBD' }, displayName: l.name, quantity: l.qty, price: l.unitCents / 100 })) }] }) }
};
const push = (provider, o) => { const a = ADAPTERS[provider]; if (!a || !a.map) return null; return { provider, simulated: true, externalId: provider.toUpperCase() + '-' + o.id, body: a.map(o) }; };
module.exports = { ADAPTERS, push, labels: Object.fromEntries(Object.entries(ADAPTERS).map(([k, v]) => [k, v.label])) };
