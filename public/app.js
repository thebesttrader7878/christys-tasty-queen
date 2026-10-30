// Christy's Tasty Queen ordering demo. Data lives in localStorage (like the KeyNest demo).
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const m = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
  const r2 = n => Math.round(n * 100) / 100;
  const LS = { get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DEF_SETTINGS = {
    name: "Christy's Tasty Queen", phone: '(913) 300-0130', address: '1405 S 55th St, Kansas City, KS 66106',
    taxRate: 9.125, // example rate, confirm with owner / accountant
    pickupMins: 15, deliveryMins: 40, deliveryOn: true, deliveryFee: 3.99, deliveryMin: 15, deliveryRadius: 4,
    acceptOrders: true, pos: 'none', pin: '1234',
    hours: DAYS.map(() => ({ open: '10:00', close: '18:00', closed: false })) // DoorDash showed 10am to 6pm on a Wednesday; confirm
  };
  const S = { menu: null, cart: LS.get('ctq_cart', []), mode: LS.get('ctq_mode', 'pickup'), q: '', tip: 0 };
  const settings = () => Object.assign({}, DEF_SETTINGS, LS.get('ctq_settings', {}));
  const saveSettings = s => LS.set('ctq_settings', s);
  const orders = () => LS.get('ctq_orders', []);
  const saveOrders = o => LS.set('ctq_orders', o);
  const saveCart = () => { LS.set('ctq_cart', S.cart); LS.set('ctq_mode', S.mode); };
  const toast = t => { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); };

  // ---------- menu with owner edits ----------
  const edits = () => LS.get('ctq_menu_edits', {});
  const item = id => { const b = S.menu.items[id]; if (!b) return null; return Object.assign({}, b, edits()[id] || {}); };
  const openNow = (s = settings(), d = new Date()) => { const h = s.hours[d.getDay()]; if (!h || h.closed) return false; const t = d.toTimeString().slice(0, 5); return t >= h.open && t < h.close; };
  const fmtT = t => { let [h, mm] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + (mm ? ':' + String(mm).padStart(2, '0') : '') + ap; };
  const todayHours = (s = settings()) => { const h = s.hours[new Date().getDay()]; return h.closed ? 'Closed today' : fmtT(h.open) + ' to ' + fmtT(h.close); };

  // ---------- pricing ----------
  const lineUnit = (it, sel) => r2(it.price + (it.modifiers || []).reduce((a, g) => a + (sel[g.id] || []).reduce((b, oi) => b + (g.options[oi] ? g.options[oi].price : 0), 0), 0));
  const totals = (cart = S.cart, mode = S.mode, tip = S.tip, s = settings()) => {
    const subtotal = r2(cart.reduce((a, l) => a + l.unit * l.qty, 0));
    const tax = r2(subtotal * s.taxRate / 100);
    const deliveryFee = mode === 'delivery' && cart.length ? +s.deliveryFee : 0;
    const total = r2(subtotal + tax + deliveryFee + (+tip || 0));
    return { subtotal, tax, deliveryFee, tip: +tip || 0, total };
  };
  const count = () => S.cart.reduce((a, l) => a + l.qty, 0);

  // ---------- views ----------
  const header = () => `<header class="top"><div class="wrap"><a class="brand" href="#/"><span class="logo">🍦</span>Christy's Tasty Queen</a><span class="grow"></span>
    <button class="cartbtn" data-act="cart" data-testid="cartbtn">🛒 <span class="hide-s">Cart</span><b data-testid="cartcount">${count()}</b></button></div></header>`;

  const itemCard = (id, popular) => { const it = item(id); if (!it || it.hidden) return ''; const so = it.soldOut;
    return `<button class="item ${so ? 'sold' : ''}" data-act="open" data-id="${id}" data-testid="item-${id}" ${so ? 'disabled' : ''}>
      ${popular ? '' : `<div class="t"><h4>${esc(it.name)}</h4><p>${esc(it.description)}</p><div class="pr">${it.price < 0.5 && it.modifiers.length ? 'From ' : ''}${m(it.price)} ${so ? '<span class="badge">Sold out</span>' : ''}</div></div>`}
      <div class="ph ${it.image ? '' : 'no'}" ${it.image ? `style="background-image:url('/${it.image}')"` : ''}>${it.image ? '' : '🍔'}<span class="plus">+</span></div>
      ${popular ? `<div class="t"><h4>${esc(it.name)}</h4><div class="pr">${m(it.price)}</div></div>` : ''}</button>`; };

  const directBox = () => `<section class="direct" data-testid="whydirect"><h3>Why order direct? 💛</h3><ul>
    <li><span>🏡</span><div><b>Support a local spot.</b> Your order goes straight to a Turner neighborhood favorite, not a big app.</div></li>
    <li><span>⚡</span><div><b>Faster pickup.</b> Your order hits Christy's kitchen right away, so it's hot and ready when you pull up.</div></li>
    <li><span>📞</span><div><b>Straight from Christy's.</b> Questions or special requests? You're talking to the folks making your food.</div></li></ul></section>`;

  const cartLines = (editable = true) => S.cart.length ? S.cart.map((l, i) => `<div class="line"><div class="grow"><b>${l.qty} × ${esc(l.name)}</b>${l.mods.length ? `<small>${esc(l.mods.join(', '))}</small>` : ''}${l.note ? `<small>Note: ${esc(l.note)}</small>` : ''}
    ${editable ? `<div style="display:flex;gap:6px;margin-top:6px"><button class="btn ghost sm" data-act="dec" data-i="${i}" aria-label="less">−</button><button class="btn ghost sm" data-act="inc" data-i="${i}" aria-label="more">+</button><button class="btn ghost sm" data-act="rm" data-i="${i}">Remove</button></div>` : ''}</div><b>${m(l.unit * l.qty)}</b></div>`).join('') : '<p class="fine">Your cart is empty. Go grab a tenderloin. 😋</p>';

  const sumHtml = t => `<div class="sum"><div><span>Subtotal</span><span>${m(t.subtotal)}</span></div><div><span>Tax</span><span>${m(t.tax)}</span></div>${S.mode === 'delivery' ? `<div><span>Delivery fee</span><span>${m(t.deliveryFee)}</span></div>` : ''}${t.tip ? `<div><span>Tip</span><span>${m(t.tip)}</span></div>` : ''}<div class="tot"><span>Total</span><span data-testid="total">${m(t.total)}</span></div></div>`;

  const HERO = ['tenderloin', 'double-cheeseburger-french-fries', 'onion-rings', 'philly-cheese-steak', 'breaded-shrimp', 'flavor-option', 'seasoned-suzy-q-s'];
  const mosaic = () => { const its = HERO.map(item).filter(x => x && x.image && !x.hidden);
    return `<div class="mosaic" data-testid="hero-photos">${its.map((it, i) => `<button class="tile t${i}" data-act="open" data-id="${it.id}" style="background-image:url('/${it.image}')" aria-label="${esc(it.name)}"><span>${it.id === 'flavor-option' ? 'Shakes &amp; malts' : esc(it.name) + ' · ' + m(it.price)}</span></button>`).join('')}</div>`; };
  const store = () => { const s = settings(), open = openNow(s), hero = item('tenderloin');
    const cats = S.menu.categories.filter(c => c.items.some(id => item(id) && !item(id).hidden));
    const q = S.q.toLowerCase();
    return header() + `<section class="hero"><div class="wrap">${mosaic()}<div style="display:grid;gap:14px">
      <div class="chips"><span class="chip ${open && s.acceptOrders ? 'open' : 'closed'}" data-testid="openchip">${open && s.acceptOrders ? '● Open now' : '● Closed, order ahead'}</span><span class="chip">🕙 ${todayHours(s)}</span><span class="chip">📍 Turner, KCK</span></div>
      <h1>Burgers, tenderloins<br>& soft serve, made fresh.</h1>
      <p>Order online from Christy's Tasty Queen for quick pickup${s.deliveryOn ? ' or local delivery' : ''}. ${esc(s.address)}</p>
      <div class="ctas"><div class="modes" role="tablist"><button class="${S.mode === 'pickup' ? 'on' : ''}" data-act="mode" data-v="pickup" data-testid="mode-pickup">Pickup · ${s.pickupMins} min</button>${s.deliveryOn ? `<button class="${S.mode === 'delivery' ? 'on' : ''}" data-act="mode" data-v="delivery" data-testid="mode-delivery">Delivery · ${s.deliveryMins} min</button>` : ''}</div>
      <a class="btn y" href="#menu" data-act="tomenu">Start your order</a></div></div>
</div></section>
      <nav class="catnav" id="menu"><div class="wrap">${cats.map(c => `<a href="#c-${c.id}" data-act="cat" data-c="${c.id}">${esc(c.name)}</a>`).join('')}</div></nav>
      <div class="wrap layout"><main>
        ${directBox()}
        <div class="search"><input type="text" placeholder="Search the menu" value="${esc(S.q)}" data-in="q" data-testid="search" aria-label="Search the menu"></div>
        ${q ? '' : `<section class="sec"><h2>🔥 Most popular</h2><div class="pop">${S.menu.popular.map(id => itemCard(id, true)).join('')}</div></section>`}
        ${cats.map(c => { const ids = c.items.filter(id => { const it = item(id); return it && !it.hidden && (!q || (it.name + ' ' + it.description).toLowerCase().includes(q)); }); if (!ids.length) return '';
          const note = /Sandwiches|Other Favorites/.test(c.name) ? 'Make it a basket: french fries and 3 onion rings.' : '';
          return `<section class="sec" id="c-${c.id}"><h2>${esc(c.name)}</h2>${note ? `<p class="note">${note}</p>` : ''}<div class="grid">${ids.map(id => itemCard(id)).join('')}</div></section>`; }).join('')}
        <footer class="foot"><b>Christy's Tasty Queen</b><span>${esc(s.address)}</span><a href="tel:${s.phone.replace(/\D/g, '')}">${esc(s.phone)}</a>
          <span>${s.hours.map((h, i) => DAYS[i] + ' ' + (h.closed ? 'closed' : fmtT(h.open) + '-' + fmtT(h.close))).join(' · ')}</span>
          <span class="fine">Demo ordering site. Payments are simulated test mode, no real money. <a href="#/admin" data-testid="ownerlink">Owner login</a></span></footer>
      </main><aside class="side card"><h3>Your order</h3>${cartLines()}${S.cart.length ? sumHtml(totals()) + '<a class="btn block" href="#/checkout" data-testid="side-checkout">Checkout</a>' : ''}</aside></div>
      ${count() ? `<a class="btn fab" href="#/checkout" data-testid="fab"><span>View cart · ${count()}</span><span>${m(totals().subtotal)}</span></a>` : ''}`; };

  // ---------- item modal ----------
  let M = null;
  const openItem = id => { const it = item(id); M = { id, qty: 1, sel: {}, note: '' };
    (it.modifiers || []).forEach(g => { M.sel[g.id] = g.type === 'single' && g.required ? [] : (g.type === 'single' ? [0] : []); });
    renderModal(); };
  const modalValid = it => (it.modifiers || []).every(g => !g.required || (M.sel[g.id] || []).length);
  const renderModal = () => { const it = item(M.id), unit = lineUnit(it, M.sel), ok = modalValid(it);
    $('#modal').hidden = false; document.body.style.overflow = 'hidden';
    $('#modal').innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(it.name)}" data-testid="itemmodal">
      ${it.image ? `<div class="img" style="background-image:url('/${it.image}')"><button class="x" data-act="close" aria-label="Close">×</button></div>` : '<div style="position:relative;height:56px"><button class="x" data-act="close" aria-label="Close">×</button></div>'}
      <div class="bd"><div><h3>${esc(it.name)}</h3><p class="d">${esc(it.description)}</p><b>${m(it.price)}</b></div>
      ${(it.modifiers || []).map(g => `<div class="mg"><div class="h"><span>${esc(g.name)}</span>${g.required ? '<span class="req">Required</span>' : '<span class="opt2">Optional</span>'}</div>
        ${g.options.map((o, oi) => `<label class="opt"><input type="${g.type === 'single' ? 'radio' : 'checkbox'}" name="g_${g.id}" data-g="${g.id}" data-oi="${oi}" ${(M.sel[g.id] || []).includes(oi) ? 'checked' : ''} data-testid="opt-${g.id}-${oi}"><span>${esc(o.name)}</span>${o.price ? '+' + m(o.price) : ''}</label>`).join('')}</div>`).join('')}
      <label class="f">Special requests<textarea rows="2" data-in="note" placeholder="No onions, extra pickles...">${esc(M.note)}</textarea></label></div>
      <div class="sbar"><div class="qty"><button data-act="mq" data-d="-1" aria-label="less">−</button><b data-testid="mqty">${M.qty}</b><button data-act="mq" data-d="1" aria-label="more">+</button></div>
      <button class="btn grow" data-act="add" data-testid="addtocart" ${ok ? '' : 'disabled'}>${ok ? 'Add to order · ' + m(unit * M.qty) : 'Pick the required options'}</button></div></div>`; };
  const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; document.body.style.overflow = ''; M = null; };
  const addToCart = () => { const it = item(M.id), mods = []; (it.modifiers || []).forEach(g => (M.sel[g.id] || []).forEach(oi => { const o = g.options[oi]; if (o && !(o.price === 0 && /^No /.test(o.name))) mods.push(o.name); }));
    S.cart.push({ id: M.id, name: it.name, qty: M.qty, unit: lineUnit(it, M.sel), mods, note: M.note.trim() }); saveCart(); closeModal(); toast('Added ' + it.name); render(); };

  // ---------- checkout ----------
  const checkout = () => { const s = settings(), t = totals(), c = LS.get('ctq_customer', {}), canDel = s.deliveryOn;
    if (!S.cart.length) return header() + `<div class="wrap page"><div class="card done"><div class="big">🛒</div><h3>Your cart is empty</h3><a class="btn" href="#/">Back to menu</a></div></div>`;
    const belowMin = S.mode === 'delivery' && t.subtotal < s.deliveryMin;
    return header() + `<div class="wrap page" style="max-width:640px"><a href="#/" class="fine">← Keep shopping</a><h1 style="margin:0;font-family:Fredoka">Checkout <span class="test">Test mode</span></h1>
      <form id="co" class="page" style="padding:0" data-testid="checkoutform">
      <div class="card"><h3>How do you want it?</h3><div class="seg"><label><input type="radio" name="mode" value="pickup" ${S.mode === 'pickup' ? 'checked' : ''} data-ch="mode"> 🛍️ Pickup<span class="fine">&nbsp;~${s.pickupMins} min</span></label>${canDel ? `<label><input type="radio" name="mode" value="delivery" ${S.mode === 'delivery' ? 'checked' : ''} data-ch="mode" data-testid="co-delivery"> 🚗 Delivery<span class="fine">&nbsp;~${s.deliveryMins} min</span></label>` : ''}</div>
        ${S.mode === 'delivery' ? `<label class="f">Delivery address<input type="text" name="address" required value="${esc(c.address || '')}" placeholder="Street, apt, city" data-testid="co-address"></label><p class="fine">Delivery within about ${s.deliveryRadius} miles. ${m(s.deliveryFee)} fee, ${m(s.deliveryMin)} minimum.</p>${belowMin ? `<p class="req">Add ${m(s.deliveryMin - t.subtotal)} more for delivery.</p>` : ''}` : `<p class="fine">Pick up at ${esc(s.address)}</p>`}
        <label class="f">When<select name="when" data-testid="co-when"><option value="asap">ASAP</option>${laterSlots(s).map(x => `<option>${x}</option>`).join('')}</select></label></div>
      <div class="card"><h3>Your info</h3><label class="f">Name<input type="text" name="name" required autocomplete="name" value="${esc(c.name || '')}" data-testid="co-name"></label>
        <div class="two"><label class="f">Phone<input type="tel" name="phone" required autocomplete="tel" value="${esc(c.phone || '')}" data-testid="co-phone"></label><label class="f">Email<input type="email" name="email" autocomplete="email" value="${esc(c.email || '')}" data-testid="co-email"></label></div>
        <label class="f">Order notes<textarea name="notes" rows="2" placeholder="Anything we should know?"></textarea></label></div>
      <div class="card"><h3>Your order</h3>${cartLines()}</div>
      <div class="card"><h3>Tip the crew</h3><div class="tips">${[0, 10, 15, 20].map(p => { const v = r2(t.subtotal * p / 100); return `<button type="button" class="${S.tip === v ? 'on' : ''}" data-act="tip" data-v="${v}">${p ? p + '%' : 'None'}</button>`; }).join('')}</div></div>
      <div class="card"><h3>Payment <span class="test">Simulated Stripe</span></h3><div class="seg"><label><input type="radio" name="pay" value="card" checked data-ch="pay"> 💳 Card</label><label><input type="radio" name="pay" value="store" data-ch="pay" data-testid="co-paystore"> 💵 Pay at pickup</label></div>
        <div id="cardbox"><label class="f">Card number<input type="text" name="card" inputmode="numeric" value="4242 4242 4242 4242" data-testid="co-card"></label><div class="two"><label class="f">Exp<input type="text" name="exp" value="12/30"></label><label class="f">CVC<input type="text" name="cvc" value="123"></label></div><p class="fine">Test mode. Use 4242 4242 4242 4242. Nothing is charged.</p></div>
        <div id="payerr" class="req" hidden></div>
        ${sumHtml(t)}
        <button class="btn block" data-testid="placeorder" ${belowMin || !s.acceptOrders ? 'disabled' : ''}>${s.acceptOrders ? 'Place order · ' + m(t.total) : 'Not taking online orders right now'}</button></div>
      </form></div>`; };
  const laterSlots = s => { const h = s.hours[new Date().getDay()]; if (h.closed) return []; const out = []; const d = new Date(); d.setMinutes(Math.ceil((d.getMinutes() + 30) / 15) * 15, 0, 0); for (let i = 0; i < 24; i++) { const t = d.toTimeString().slice(0, 5); if (t >= h.open && t < h.close) out.push('Today ' + fmtT(t)); d.setMinutes(d.getMinutes() + 15); } return out; };

  const placeOrder = async f => { const s = settings(), t = totals(), d = Object.fromEntries(new FormData(f));
    const err = $('#payerr'); err.hidden = true;
    const pay = PAY.charge({ amount: t.total, method: d.pay, card: d.card });
    if (!pay.ok) { err.textContent = pay.error; err.hidden = false; return; }
    LS.set('ctq_customer', { name: d.name, phone: d.phone, email: d.email, address: d.address || '' });
    const id = String(1000 + orders().length + 1) + Math.random().toString(36).slice(2, 4).toUpperCase();
    const o = { id, created: new Date().toISOString(), status: 'new', mode: S.mode, when: d.when, customer: { name: d.name, phone: d.phone, email: d.email, address: d.address || '' }, notes: d.notes || '',
      items: S.cart.map(l => Object.assign({}, l, { lineTotal: r2(l.unit * l.qty) })), ...t, payment: pay };
    o.pos = POS.current().pushOrder(o);
    const all = orders(); all.unshift(o); saveOrders(all);
    try { const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }); o.email = await r.json(); } catch (e) { o.email = { ok: false, error: 'offline' }; }
    const all2 = orders(); all2[0] = o; saveOrders(all2);
    S.cart = []; S.tip = 0; saveCart(); location.hash = '#/order/' + id; };

  const confirmation = id => { const o = orders().find(x => x.id === id), s = settings(); if (!o) return header() + '<div class="wrap page"><div class="card">Order not found. <a href="#/">Menu</a></div></div>';
    const st = ['new', 'preparing', 'ready', 'completed'], k = st.indexOf(o.status);
    return header() + `<div class="wrap page" style="max-width:600px"><div class="card done" data-testid="confirmation"><div class="big">🎉</div><h2 style="margin:0">Thanks, ${esc(o.customer.name.split(' ')[0])}! Order #${esc(o.id)} is in.</h2>
      <p class="mut" style="margin:0">${o.mode === 'delivery' ? `Delivery to ${esc(o.customer.address)} in about ${s.deliveryMins} min.` : `Pickup at ${esc(s.address)} in about ${s.pickupMins} min.`} ${o.when !== 'asap' ? '(' + esc(o.when) + ')' : ''}</p>
      <div class="steps">${st.slice(0, 3).map((x, i) => `<div class="${i <= k ? 'on' : ''}"></div>`).join('')}</div><b data-testid="orderstatus">${{ new: 'Order received', preparing: 'Being made', ready: o.mode === 'delivery' ? 'On the way' : 'Ready for pickup', completed: 'Completed' }[o.status]}</b>
      <span class="test">Test order · ${esc(o.payment.label)}${o.email && o.email.ok ? ' · emailed to the store' : ''}</span></div>
      <div class="card"><h3>Receipt</h3>${o.items.map(l => `<div class="line"><div class="grow"><b>${l.qty} × ${esc(l.name)}</b>${l.mods.length ? `<small>${esc(l.mods.join(', '))}</small>` : ''}</div><b>${m(l.lineTotal)}</b></div>`).join('')}
      <div class="sum"><div><span>Subtotal</span><span>${m(o.subtotal)}</span></div><div><span>Tax</span><span>${m(o.tax)}</span></div>${o.deliveryFee ? `<div><span>Delivery</span><span>${m(o.deliveryFee)}</span></div>` : ''}${o.tip ? `<div><span>Tip</span><span>${m(o.tip)}</span></div>` : ''}<div class="tot"><span>Total</span><span>${m(o.total)}</span></div></div></div>
      <div class="card"><p style="margin:0">Questions? Call <a href="tel:${s.phone.replace(/\D/g, '')}">${esc(s.phone)}</a></p><a class="btn ghost" href="#/">Back to menu</a></div></div>`; };

  // ---------- owner dashboard ----------
  let tab = 'orders';
  const admin = () => { if (!sessionStorage.getItem('ctq_owner')) return header() + `<div class="wrap page" style="max-width:420px"><form class="card" id="login"><h3>Owner login</h3><p class="fine">Demo PIN is 1234.</p><input type="password" name="pin" inputmode="numeric" placeholder="PIN" data-testid="pin"><button class="btn" data-testid="login">Log in</button></form></div>`;
    const s = settings(), os = orders(), today = os.filter(o => o.created.slice(0, 10) === new Date().toISOString().slice(0, 10));
    const tabs = [['orders', '📋 Orders'], ['menu', '🍔 Menu'], ['hours', '🕙 Hours & settings'], ['payments', '💳 Payments & POS']];
    let body = '';
    if (tab === 'orders') body = `<div class="kpis"><div><b>${today.length}</b><span class="fine">Orders today</span></div><div><b>${m(today.reduce((a, o) => a + o.total, 0))}</b><span class="fine">Sales today</span></div><div><b>${os.filter(o => o.status !== 'completed').length}</b><span class="fine">Open</span></div></div>
      <label class="switchrow" style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" data-ch="accept" ${s.acceptOrders ? 'checked' : ''}> Taking online orders</label>
      ${os.map(o => `<div class="ord" data-testid="ord-${o.id}"><div class="h"><b>#${esc(o.id)} · ${esc(o.customer.name)}</b><span class="st ${o.status}">${o.status}</span></div>
        <span class="fine">${new Date(o.created).toLocaleString()} · ${o.mode === 'delivery' ? '🚗 ' + esc(o.customer.address) : '🛍️ Pickup'} · ${esc(o.when)} · ${esc(o.customer.phone)}</span>
        <div>${o.items.map(l => `${l.qty}× ${esc(l.name)}${l.mods.length ? ' <span class="fine">(' + esc(l.mods.join(', ')) + ')</span>' : ''}${l.note ? ' <i class="fine">' + esc(l.note) + '</i>' : ''}`).join('<br>')}</div>
        ${o.notes ? `<span class="fine">Note: ${esc(o.notes)}</span>` : ''}<div class="h"><b>${m(o.total)} · ${esc(o.payment.label)}</b><span>${o.status === 'new' ? `<button class="btn sm" data-act="st" data-id="${o.id}" data-v="preparing" data-testid="accept-${o.id}">Accept</button>` : o.status === 'preparing' ? `<button class="btn sm" data-act="st" data-id="${o.id}" data-v="ready" data-testid="ready-${o.id}">Mark ready</button>` : o.status === 'ready' ? `<button class="btn sm dark" data-act="st" data-id="${o.id}" data-v="completed">Complete</button>` : ''}</span></div></div>`).join('') || '<p class="fine">No orders yet.</p>'}`;
    if (tab === 'menu') body = `<p class="fine">Change prices, hide items or mark sold out. Saved right away.</p>${S.menu.categories.map(c => `<h3 style="margin:10px 0 0">${esc(c.name)}</h3>${c.items.filter((id, i, a) => a.indexOf(id) === i).map(id => { const it = item(id); return `<div class="ed"><span>${esc(it.name)}${it.hidden ? ' <span class="badge">hidden</span>' : ''}</span><input type="number" step="0.01" value="${it.price}" data-ed="price" data-id="${id}" data-testid="price-${id}" aria-label="price"><span style="display:grid;gap:4px"><button class="btn ghost sm" data-act="so" data-id="${id}">${it.soldOut ? 'In stock' : 'Sold out'}</button><button class="btn ghost sm" data-act="hide" data-id="${id}">${it.hidden ? 'Show' : 'Hide'}</button></span></div>`; }).join('')}`).join('')}<button class="btn ghost" data-act="resetmenu">Reset menu edits</button>`;
    if (tab === 'hours') body = `<form id="setf" class="page" style="padding:0"><h3>Hours</h3>${s.hours.map((h, i) => `<div class="hrs"><b>${DAYS[i]}</b><input type="time" name="o${i}" value="${h.open}"><input type="time" name="c${i}" value="${h.close}"><label class="fine"><input type="checkbox" name="x${i}" ${h.closed ? 'checked' : ''}> Closed</label></div>`).join('')}
      <h3>Pickup & delivery</h3><div class="two"><label class="f">Pickup time (min)<input type="number" name="pickupMins" value="${s.pickupMins}"></label><label class="f">Delivery time (min)<input type="number" name="deliveryMins" value="${s.deliveryMins}"></label>
      <label class="f">Delivery fee<input type="number" step="0.01" name="deliveryFee" value="${s.deliveryFee}" data-testid="set-fee"></label><label class="f">Delivery minimum<input type="number" step="0.01" name="deliveryMin" value="${s.deliveryMin}"></label>
      <label class="f">Delivery radius (mi)<input type="number" step="0.5" name="deliveryRadius" value="${s.deliveryRadius}"></label><label class="f">Sales tax %<input type="number" step="0.001" name="taxRate" value="${s.taxRate}"></label></div>
      <label style="display:flex;gap:8px;font-weight:700"><input type="checkbox" name="deliveryOn" ${s.deliveryOn ? 'checked' : ''}> Offer delivery</label>
      <button class="btn" data-testid="savesettings">Save</button></form>`;
    if (tab === 'payments') { const a = PAY.account(), pl = POS.log().slice(0, 5);
      body = `<div class="ord"><b>Stripe <span class="test">Simulated test mode</span></b>${a.status === 'connected' ? `<span>✅ Connected: ${esc(a.business)} (${esc(a.id)}) · payouts to ${esc(a.bank)}</span><button class="btn ghost sm" data-act="disc">Disconnect</button>` : a.status === 'pending' ? `<span>Step 2 of 2: add a bank for payouts (test)</span><button class="btn sm" data-act="finish" data-testid="stripe-finish">Add test bank & finish</button>` : `<span class="fine">Connect Christy's own Stripe account so card payments land in her bank. This is a simulation, no keys, no money.</span><button class="btn sm" data-act="connect" data-testid="stripe-connect">Connect with Stripe (test)</button>`}
        <span class="fine">Card fees (Stripe standard 2.9% + 30¢) are shown per order. Cards: ${os.filter(o => o.payment.fee).length} orders, ${m(os.reduce((x, o) => x + (o.payment.fee || 0), 0))} in fees.</span></div>
        <div class="ord"><b>POS connection <span class="test">Stubbed</span></b><select data-ch="pos" data-testid="pos-select">${Object.values(POS.adapters).map(p => `<option value="${p.id}" ${s.pos === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
        <span class="fine">Square, Clover and Toast adapters are built but stubbed until we know which POS Christy's uses. Orders get mapped to that POS's order format and logged here.</span>
        ${pl.map(x => `<span class="fine">${new Date(x.at).toLocaleTimeString()} · ${esc(x.provider)} · ${esc(x.action)}</span>`).join('')}</div>`; }
    return header() + `<div class="wrap page"><div style="display:flex;justify-content:space-between;align-items:center"><h1 style="margin:0;font-family:Fredoka">Owner dashboard</h1><button class="btn ghost sm" data-act="logout">Log out</button></div>
      <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/admin" class="${tab === k ? 'on' : ''}" data-act="tab" data-v="${k}" data-testid="tab-${k}">${l}</a>`).join('')}</nav><div class="card">${body}</div></div>`; };

  // ---------- router ----------
  const render = () => { const h = location.hash || '#/'; let html;
    if (h.startsWith('#/checkout')) html = checkout(); else if (h.startsWith('#/order/')) html = confirmation(h.slice(8)); else if (h.startsWith('#/admin')) html = admin(); else html = store();
    const old = $('#co'), keep = old ? [...old.elements].filter(x => x.name && x.type !== 'radio').map(x => [x.name, x.value]) : null;
    $('#app').innerHTML = html;
    const nf = $('#co'); if (keep && nf) keep.forEach(([k, v]) => { const x = nf.elements[k]; if (x && x.type !== 'radio' && x.tagName !== 'BUTTON') x.value = v; }); };
  window.addEventListener('hashchange', () => { if (!/^#c-|^#menu/.test(location.hash)) { render(); scrollTo(0, 0); } });

  document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el) { if (e.target.id === 'modal') closeModal(); return; } const a = el.dataset.act, s = settings();
    if (a === 'open') openItem(el.dataset.id); else if (a === 'close') closeModal(); else if (a === 'add') addToCart();
    else if (a === 'mq') { M.qty = Math.max(1, M.qty + +el.dataset.d); renderModal(); }
    else if (a === 'mode') { S.mode = el.dataset.v; saveCart(); render(); }
    else if (a === 'cart') { location.hash = '#/checkout'; }
    else if (a === 'inc' || a === 'dec' || a === 'rm') { const l = S.cart[+el.dataset.i]; if (a === 'inc') l.qty++; else if (a === 'dec') l.qty--; if (a === 'rm' || l.qty < 1) S.cart.splice(+el.dataset.i, 1); saveCart(); render(); }
    else if (a === 'tip') { S.tip = +el.dataset.v; render(); }
    else if (a === 'tab') { e.preventDefault(); tab = el.dataset.v; render(); }
    else if (a === 'logout') { sessionStorage.removeItem('ctq_owner'); render(); }
    else if (a === 'st') { const os = orders(), o = os.find(x => x.id === el.dataset.id); o.status = el.dataset.v; POS.current().updateStatus(o, o.status); saveOrders(os); render(); }
    else if (a === 'so' || a === 'hide') { const ed = edits(), k = a === 'so' ? 'soldOut' : 'hidden'; ed[el.dataset.id] = Object.assign({}, ed[el.dataset.id], { [k]: !item(el.dataset.id)[k] }); LS.set('ctq_menu_edits', ed); render(); }
    else if (a === 'resetmenu') { LS.set('ctq_menu_edits', {}); toast('Menu reset'); render(); }
    else if (a === 'connect') { PAY.startConnect(s.name); render(); } else if (a === 'finish') { PAY.finishConnect(); toast('Stripe connected (test)'); render(); } else if (a === 'disc') { PAY.disconnect(); render(); }
    else if (a === 'cat') { document.querySelectorAll('.catnav a').forEach(x => x.classList.toggle('on', x === el)); }
  });
  document.addEventListener('change', e => { const el = e.target;
    if (el.dataset.g && M) { const g = item(M.id).modifiers.find(x => x.id === el.dataset.g), oi = +el.dataset.oi; if (g.type === 'single') M.sel[g.id] = [oi]; else { const s = M.sel[g.id] || []; M.sel[g.id] = el.checked ? s.concat(oi) : s.filter(x => x !== oi); } renderModal(); }
    else if (el.dataset.ch === 'mode') { S.mode = el.value; saveCart(); render(); }
    else if (el.dataset.ch === 'pay') { $('#cardbox').hidden = el.value !== 'card'; }
    else if (el.dataset.ch === 'accept') { const s = settings(); s.acceptOrders = el.checked; saveSettings(s); render(); }
    else if (el.dataset.ch === 'pos') { const s = settings(); s.pos = el.value; saveSettings(s); POS.current().connect(); toast(POS.current().label + ' selected (stub)'); render(); }
    else if (el.dataset.ed === 'price') { const ed = edits(); ed[el.dataset.id] = Object.assign({}, ed[el.dataset.id], { price: r2(+el.value) }); LS.set('ctq_menu_edits', ed); toast('Price saved'); }
  });
  document.addEventListener('input', e => { const el = e.target; if (el.dataset.in === 'q') { S.q = el.value; const pos = el.selectionStart; render(); const n = $('[data-in=q]'); n.focus(); n.setSelectionRange(pos, pos); } else if (el.dataset.in === 'note' && M) M.note = el.value; });
  document.addEventListener('submit', e => { e.preventDefault(); const f = e.target;
    if (f.id === 'co') placeOrder(f);
    else if (f.id === 'login') { if (f.pin.value === settings().pin) { sessionStorage.setItem('ctq_owner', '1'); render(); } else toast('Wrong PIN'); }
    else if (f.id === 'setf') { const d = Object.fromEntries(new FormData(f)), s = settings();
      s.hours = DAYS.map((x, i) => ({ open: d['o' + i], close: d['c' + i], closed: !!d['x' + i] }));
      ['pickupMins', 'deliveryMins', 'deliveryFee', 'deliveryMin', 'deliveryRadius', 'taxRate'].forEach(k => s[k] = +d[k]); s.deliveryOn = !!d.deliveryOn; saveSettings(s); toast('Saved'); render(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && M) closeModal(); });

  window.CTQ = { totals, lineUnit, openNow };
  fetch('/menu.json').then(r => r.json()).then(d => { S.menu = d; render(); });
})();
