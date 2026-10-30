// POS integration layer. All adapters are STUBS: no network calls, no keys.
// When we know which POS Christy's uses, fill in the matching adapter on the server side
// (POS tokens must never live in the browser).
(function () {
  const LOG = 'ctq_pos_log';
  const log = (provider, action, payload) => {
    const l = JSON.parse(localStorage.getItem(LOG) || '[]');
    l.unshift({ at: new Date().toISOString(), provider, action, payload });
    localStorage.setItem(LOG, JSON.stringify(l.slice(0, 50)));
  };
  // Shared shape every adapter must accept: our internal order object from app.js.
  const toLines = o => o.items.map(i => ({ name: i.name, qty: i.qty, unitCents: Math.round(i.unit * 100), mods: i.mods, note: i.note || '' }));
  const base = (id, label, docs, mapper) => ({
    id, label, docs, stub: true,
    connect: () => { log(id, 'connect', 'stub'); return { ok: true, simulated: true, msg: label + ' connection is stubbed for now' }; },
    pushOrder: o => { const body = mapper(o); log(id, 'pushOrder', body); return { ok: true, simulated: true, externalId: id.toUpperCase() + '-' + o.id, body }; },
    syncMenu: menu => { log(id, 'syncMenu', { items: Object.keys(menu.items).length }); return { ok: true, simulated: true }; },
    updateStatus: (o, status) => { log(id, 'updateStatus', { id: o.id, status }); return { ok: true, simulated: true }; }
  });
  const adapters = {
    none: { id: 'none', label: 'No POS (orders show in this dashboard + email)', stub: false, connect: () => ({ ok: true }), pushOrder: () => ({ ok: true, skipped: true }), syncMenu: () => ({ ok: true }), updateStatus: () => ({ ok: true }) },
    // Square: Orders API  POST /v2/orders  (line_items[].base_price_money.amount in cents)
    square: base('square', 'Square', 'https://developer.squareup.com/reference/square/orders-api/create-order', o => ({
      idempotency_key: o.id, order: { location_id: 'LOCATION_ID_TBD', reference_id: o.id,
        line_items: toLines(o).map(l => ({ name: l.name, quantity: String(l.qty), base_price_money: { amount: l.unitCents, currency: 'USD' }, note: [l.mods.join(', '), l.note].filter(Boolean).join(' | ') })),
        fulfillments: [{ type: o.mode === 'delivery' ? 'DELIVERY' : 'PICKUP', state: 'PROPOSED' }] } })),
    // Clover: Atomic Order API  POST /v3/merchants/{mId}/atomic_order/orders
    clover: base('clover', 'Clover', 'https://docs.clover.com/dev/docs/atomic-orders', o => ({
      orderCart: { title: 'Online #' + o.id, note: o.notes || '', lineItems: toLines(o).flatMap(l => Array(l.qty).fill({ name: l.name, price: l.unitCents, note: [l.mods.join(', '), l.note].filter(Boolean).join(' | ') })) } })),
    // Toast: Orders API  POST /orders/v2/orders  (needs partner access + menu GUIDs)
    toast: base('toast', 'Toast', 'https://doc.toasttab.com/doc/devguide/apiOrders.html', o => ({
      entityType: 'Order', externalId: o.id, diningOption: { guid: o.mode === 'delivery' ? 'DELIVERY_OPTION_GUID_TBD' : 'TAKEOUT_OPTION_GUID_TBD' },
      checks: [{ selections: toLines(o).map(l => ({ item: { guid: 'MENU_ITEM_GUID_TBD' }, displayName: l.name, quantity: l.qty, price: l.unitCents / 100 })) }] }))
  };
  window.POS = {
    adapters,
    current: () => adapters[(JSON.parse(localStorage.getItem('ctq_settings') || '{}').pos) || 'none'] || adapters.none,
    log: () => JSON.parse(localStorage.getItem(LOG) || '[]')
  };
})();
