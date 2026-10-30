// Kimmie’s-Christy's Tasty Queen storefront. Orders, menu edits and hours live on the server; only the cart and
// the customer's own order links live in this browser.
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const m = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
  const r2 = n => Math.round(n * 100) / 100;
  const LS = { get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DEF_SETTINGS = {
    name: "Kimmie’s-Christy's Tasty Queen", phone: '(913) 300-0130', address: '1405 S 55th St, Kansas City, KS 66106',
    doordashUrl: 'https://www.doordash.com/store/christys-tasty-queen-kansas-city-35171507/',
    taxRate: 9.125, // example rate, confirm with owner / accountant
    pickupMins: 15,
    acceptOrders: true,
    hours: DAYS.map(() => ({ open: '10:00', close: '18:00', closed: false })) // DoorDash showed 10am to 6pm on a Wednesday; confirm
  };
  const S = { menu: null, cfg: { settings: {}, menuEdits: {}, stripe: { mode: 'demo' } }, cart: LS.get('ctq_cart', []), mode: 'pickup', q: '', tip: 0, conf: {} };
  const settings = () => Object.assign({}, DEF_SETTINGS, S.cfg.settings, { name: DEF_SETTINGS.name });
  const myOrders = () => LS.get('ctq_my_orders', {}); // { orderId: token }
  // First-party analytics only: an anonymous random id per browser, no cookies, no third parties.
  const SID = (() => { let s = LS.get('ctq_sid', ''); if (!/^[a-z0-9]{8,40}$/.test(s)) { s = (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 20); LS.set('ctq_sid', s); } return s; })();
  const sent = {};
  const track = (type, once) => { if (once && sent[type]) return; sent[type] = 1; const b = JSON.stringify({ type, sid: SID, path: location.hash.slice(0, 40) });
    try { if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([b], { type: 'application/json' })); else fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b, keepalive: true }); } catch (e) {} };
  const saveCart = () => { LS.set('ctq_cart', S.cart); LS.set('ctq_mode', S.mode); setTimeout(() => window.dispatchEvent(new Event('ctq-cart')), 0); };
  const toast = t => { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); };

  // ---------- menu with owner edits ----------
  const edits = () => S.cfg.menuEdits || {};
  const item = id => { const b = S.menu.items[id]; if (!b) return null; return Object.assign({}, b, edits()[id] || {}); };
  // Store time is Kansas City time, no matter where the customer's phone thinks it is.
  const kc = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value])); return { day: DAYS.indexOf(p.weekday), t: p.hour + ':' + p.minute }; };
  const openNow = (s = settings()) => { const k = kc(), h = s.hours[k.day]; if (!h || h.closed) return false; return k.t >= h.open && k.t < h.close; };
  const fmtT = t => { let [h, mm] = t.split(':').map(Number); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + (mm ? ':' + String(mm).padStart(2, '0') : '') + ap; };
  const todayHours = (s = settings()) => { const h = s.hours[kc().day]; return h.closed ? 'Closed today' : fmtT(h.open) + ' to ' + fmtT(h.close); };

  // ---------- pricing ----------
  const lineUnit = (it, sel) => r2(it.price + (it.modifiers || []).reduce((a, g) => a + (sel[g.id] || []).reduce((b, oi) => b + (g.options[oi] ? g.options[oi].price : 0), 0), 0));
  const totals = (cart = S.cart, mode = S.mode, tip = S.tip, s = settings()) => {
    const subtotal = r2(cart.reduce((a, l) => a + l.unit * l.qty, 0));
    const tax = r2(subtotal * s.taxRate / 100);
    const deliveryFee = 0;
    const total = r2(subtotal + tax + deliveryFee + (+tip || 0));
    return { subtotal, tax, deliveryFee, tip: +tip || 0, total };
  };
  const count = () => S.cart.reduce((a, l) => a + l.qty, 0);

  // ---------- views ----------
  const header = () => `<header class="top"><div class="wrap"><a class="brand" href="#/" aria-label="Kimmie’s-Christy's Tasty Queen home"><img class="logo" src="/img/logo-180.jpg" alt="Kimmie’s-Christy's Tasty Queen logo" data-testid="logo"><span class="bname" data-testid="bizname">Kimmie’s-Christy's<b>Tasty Queen</b></span></a><span class="grow"></span>
    <a class="toplink hide-s" href="#c-sandwiches">Menu</a><a class="toplink hide-s" href="#visit">Visit</a>
    <button class="cartbtn" data-act="cart" data-testid="cartbtn" aria-label="Cart">🛒 <span class="hide-s">Cart</span><b data-testid="cartcount" class="${count() ? 'bump' : ''}">${count()}</b></button></div></header>`;

  // Branded fallback for items with no photo: brand color, item name, soft-serve swirl motif.
  const PAL = [['#d7263d', '#8f1424'], ['#ff8a3d', '#d7263d'], ['#1d1b1a', '#4a2a22'], ['#ffc93c', '#ff8a3d']];
  const fallback = (it, big) => { const h = [...it.id].reduce((a, c) => a + c.charCodeAt(0), 0) % PAL.length, [a, b] = PAL[h];
    return `<div class="fb ${big ? 'big' : ''}" style="--a:${a};--b:${b}"><span class="swirl">🍦</span><span class="fbn">${esc(it.name)}</span><span class="fbt">Christy's</span></div>`; };
  const photo = (it, cls = 'ph') => it.image ? `<div class="${cls}" style="background-image:url('/${it.image}')"></div>` : `<div class="${cls} nophoto">${fallback(it)}</div>`;

  const itemCard = (id, popular) => { const it = item(id); if (!it || it.hidden) return ''; const so = it.soldOut;
    return `<button class="item ${popular ? 'popc' : ''} ${so ? 'sold' : ''}" data-act="open" data-id="${id}" data-testid="item-${id}" ${so ? 'disabled' : ''}>
      ${photo(it)}<span class="plus" aria-hidden="true">+</span>${DDR[id] ? `<span class="rate">👍 ${DDR[id]}</span>` : ''}
      <div class="t"><h4>${esc(it.name)}</h4>${popular ? '' : `<p>${esc(it.description)}</p>`}<div class="pr">${fromPrice(it) > it.price ? 'From ' + m(fromPrice(it)) : m(it.price)} ${so ? '<span class="badge">Sold out</span>' : ''}</div></div></button>`; };

  const directBox = () => `<section class="direct reveal" data-testid="whydirect"><div><span class="kicker">Why order direct?</span><h2>Skip the app. Order from us.</h2></div><ul>
    <li><span>🏡</span><div><b>Support a local spot.</b> Your order goes straight to a Turner neighborhood favorite, not a big app.</div></li>
    <li><span>⚡</span><div><b>Faster pickup.</b> Your order hits Christy's kitchen right away, so it's hot and ready when you pull up.</div></li>
    <li><span>📞</span><div><b>Straight from Christy's.</b> Questions or special requests? You're talking to the folks making your food.</div></li></ul></section>`;

  const cartLines = (editable = true) => S.cart.length ? S.cart.map((l, i) => `<div class="line"><div class="grow"><b>${l.qty} × ${esc(l.name)}</b>${l.mods.length ? `<small>${esc(l.mods.join(', '))}</small>` : ''}${l.note ? `<small>Note: ${esc(l.note)}</small>` : ''}
    ${editable ? `<div style="display:flex;gap:6px;margin-top:6px"><button class="btn ghost sm" data-act="dec" data-i="${i}" aria-label="less">−</button><button class="btn ghost sm" data-act="inc" data-i="${i}" aria-label="more">+</button><button class="btn ghost sm" data-act="rm" data-i="${i}">Remove</button></div>` : ''}</div><b>${m(l.unit * l.qty)}</b></div>`).join('') : '<p class="fine">Your cart is empty. Go grab a tenderloin. 😋</p>';

  const sumHtml = t => `<div class="sum"><div><span>Subtotal</span><span>${m(t.subtotal)}</span></div><div><span>Tax</span><span>${m(t.tax)}</span></div>${t.tip ? `<div><span>Tip</span><span>${m(t.tip)}</span></div>` : ''}<div class="tot"><span>Total</span><span data-testid="total">${m(t.total)}</span></div></div>`;

  // Real DoorDash rating snippets seen on her store page (Oct 2026). No invented reviews.
  const DDR = { tenderloin: '93% (47)', 'onion-rings': '100% (16)', 'breaded-mushrooms': '88% (18)' };
  const HERO = ['tenderloin', 'double-cheeseburger-french-fries', 'onion-rings', 'philly-cheese-steak', 'breaded-shrimp', 'flavor-option', 'seasoned-suzy-q-s'];
  const mosaic = () => { const its = HERO.map(item).filter(x => x && x.image && !x.hidden);
    return `<div class="mosaic" data-testid="hero-photos">${its.map((it, i) => `<button class="tile t${i}" data-act="open" data-id="${it.id}" style="background-image:url('/${it.image}')" aria-label="${esc(it.name)}"><span>${it.id === 'flavor-option' ? 'Shakes &amp; malts' : esc(it.name) + ' · ' + m(it.price)}</span></button>`).join('')}</div>`; };
  const ddBtn = (s, where) => `<a class="btn dd" href="${esc(s.doordashUrl)}" target="_blank" rel="noopener" data-testid="dd-${where}">🚗 Want delivery? Order on DoorDash</a>`;
  const CATICON = { extras: '🧂', 'sweet-treats': '🍦', 'sodas-floats-shakes-malts': '🥤', drinks: '🧃', 'daily-specials': '⭐' };
  const catTiles = cats => `<section class="cats reveal" data-testid="cattiles"><div class="sech"><span class="kicker">Browse</span><h2>What are you craving?</h2></div><div class="ctiles">${cats.map(c => { const ph = c.items.map(item).find(x => x && x.image && !x.hidden);
    return `<a class="ctile ${ph ? '' : 'noimg'}" href="#c-${c.id}" ${ph ? `style="background-image:url('/${ph.image}')"` : ''}>${ph ? '' : `<i>${CATICON[c.id] || '🍔'}</i>`}<span>${esc(c.name)}<small>${c.items.length} item${c.items.length === 1 ? "" : "s"}</small></span></a>`; }).join('')}</div></section>`;
  const store = () => { const s = settings(), open = openNow(s);
    const cats = S.menu.categories.filter(c => c.items.some(id => item(id) && !item(id).hidden));
    const q = S.q.toLowerCase(), tel = s.phone.replace(/\D/g, ''), map = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent("Kimmie’s-Christy's Tasty Queen " + s.address);
    return header() + `<section class="hero"><div class="wrap">${mosaic()}<div class="hcopy">
      <img class="hlogo" src="/img/logo.jpg" alt="Kimmie’s-Christy's Tasty Queen" data-testid="hero-logo">
      <p class="hname" data-testid="hero-name">Kimmie’s-Christy's Tasty Queen</p>
      <div class="chips"><span class="chip ${open && s.acceptOrders ? 'open' : 'closed'}" data-testid="openchip"><i class="dot"></i>${open && s.acceptOrders ? 'Open now' : 'Closed, order ahead'}</span><span class="chip">🕙 ${todayHours(s)}</span><span class="chip">📍 Turner, KCK</span></div>
      <h1>Crispy tenderloins.<br>Real burgers.<br><em>Cold soft serve.</em></h1>
      <p>Turner's neighborhood drive-in at ${esc(s.address.split(',')[0])}. Order ahead and it's hot when you pull up.</p>
      <div class="ctas"><a class="btn y xl" href="#c-sandwiches" data-act="tomenu" data-testid="order-pickup">Order pickup <span class="arrow">→</span></a><span class="chip pick">🛍️ Ready in ~${s.pickupMins} min</span></div>
      ${ddBtn(s, 'hero')}</div></div></section>
      <section class="proof wrap reveal" data-testid="proof"><div><b>#1</b><span>Most liked on DoorDash: the Tenderloin</span></div><div><b>100%</b><span>thumbs up on our Onion Rings (16 DoorDash ratings)</span></div><div><b>69</b><span>menu items made to order</span></div><div><b>📍</b><span>Right on S 55th St in Turner</span></div></section>
      <nav class="catnav" id="menu"><div class="wrap">${cats.map(c => `<a href="#c-${c.id}" data-act="cat" data-c="${c.id}">${esc(c.name)}</a>`).join('')}</div></nav>
      <div class="wrap layout"><main>
        ${q ? '' : catTiles(cats)}
        <div class="search"><input type="text" placeholder="Search tenderloin, shakes, onion rings..." value="${esc(S.q)}" data-in="q" data-testid="search" aria-label="Search the menu"></div>
        ${q ? '' : `<section class="sec reveal"><div class="sech"><span class="kicker">Fan favorites</span><h2>🔥 Most popular</h2></div><div class="pop">${S.menu.popular.map(id => itemCard(id, true)).join('')}</div></section>`}
        ${q ? '' : directBox()}
        ${cats.map(c => { const ids = c.items.filter(id => { const it = item(id); return it && !it.hidden && (!q || (it.name + ' ' + it.description).toLowerCase().includes(q)); }); if (!ids.length) return '';
          const note = /Sandwiches|Other Favorites/.test(c.name) ? 'Make it a basket: french fries and 3 onion rings.' : '';
          return `<section class="sec" id="c-${c.id}"><div class="sech"><h2>${esc(c.name)}</h2>${note ? `<p class="note">${note}</p>` : ''}</div><div class="grid">${ids.map(id => itemCard(id)).join('')}</div></section>`; }).join('')}
        <section class="visit reveal" id="visit" data-testid="visit"><div><span class="kicker">Come see us</span><h2>Hours & location</h2>
          <p class="addr">${esc(s.address)}</p><div class="vbtns"><a class="btn dark" href="${map}" target="_blank" rel="noopener" data-testid="maplink">📍 Get directions</a><a class="btn ghost" href="tel:${tel}">📞 ${esc(s.phone)}</a></div></div>
          <ul class="hours">${s.hours.map((h, i) => `<li class="${i === kc().day ? 'today' : ''}"><span>${DAYS[i]}</span><b>${h.closed ? 'Closed' : fmtT(h.open) + ' to ' + fmtT(h.close)}</b></li>`).join('')}</ul></section>
        <footer class="foot"><b>Kimmie’s-Christy's Tasty Queen</b><span>${esc(s.address)} · <a href="tel:${tel}">${esc(s.phone)}</a></span>
          <span class="fine">Demo ordering site. Payments are simulated test mode, no real money.</span></footer>
      </main><aside class="side"><div class="card"><h3>Your order</h3>${cartLines()}${S.cart.length ? sumHtml(totals()) + '<a class="btn block" href="#/checkout" data-testid="side-checkout">Checkout</a>' : ''}</div></aside></div>
      ${count() ? `<a class="btn fab" href="#/checkout" data-testid="fab"><span class="fq">${count()}</span><span>View cart</span><span>${m(totals().subtotal)}</span></a>` : ''}`; };

  // ---------- item modal ----------
  let M = null;
  const openItem = id => { const it = item(id); M = { id, qty: 1, sel: {}, note: '' };
    (it.modifiers || []).forEach(g => { M.sel[g.id] = g.type === 'single' && g.required ? [] : (g.type === 'single' ? [0] : []); });
    renderModal(); };
  const modalValid = it => (it.modifiers || []).every(g => !g.required || (M.sel[g.id] || []).length);
  const fromPrice = it => it.price + (it.modifiers || []).filter(x => x.required && x.type === 'single' && x.options.length).reduce((s, x) => s + Math.min(...x.options.map(o => +o.price || 0)), 0);
  const renderModal = () => { const it = item(M.id), unit = lineUnit(it, M.sel), ok = modalValid(it);
    modalY = window.scrollY; $('#modal').hidden = false; document.body.style.overflow = 'hidden';
    $('#modal').innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(it.name)}" data-testid="itemmodal">
      <div class="grab"></div><div class="img">${it.image ? `<div class="ph" style="background-image:url('/${it.image}')"></div>` : fallback(it, true)}<button class="x" data-act="close" aria-label="Close">×</button></div>
      <div class="bd"><div><h3>${esc(it.name)}</h3><p class="d">${esc(it.description)}</p><b>${fromPrice(it) > it.price ? 'From ' + m(fromPrice(it)) : m(it.price)}</b></div>
      ${(it.modifiers || []).map(g => `<div class="mg"><div class="h"><span>${esc(g.name)}</span>${g.required ? '<span class="req">Required</span>' : '<span class="opt2">Optional</span>'}</div>
        ${g.options.map((o, oi) => `<label class="opt"><input type="${g.type === 'single' ? 'radio' : 'checkbox'}" name="g_${g.id}" data-g="${g.id}" data-oi="${oi}" ${(M.sel[g.id] || []).includes(oi) ? 'checked' : ''} data-testid="opt-${g.id}-${oi}"><span>${esc(o.name)}</span>${o.price ? (it.price ? '+' : '') + m(o.price) : ''}</label>`).join('')}</div>`).join('')}
      <label class="f">Special requests<textarea rows="2" data-in="note" placeholder="No onions, extra pickles...">${esc(M.note)}</textarea></label></div>
      <div class="sbar"><div class="qty"><button data-act="mq" data-d="-1" aria-label="less">−</button><b data-testid="mqty">${M.qty}</b><button data-act="mq" data-d="1" aria-label="more">+</button></div>
      <button class="btn grow" data-act="add" data-testid="addtocart" ${ok ? '' : 'disabled'}>${ok ? 'Add to order · ' + m(unit * M.qty) : 'Pick the required options'}</button></div></div>`; };
  let modalY = 0;
  const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; document.body.style.overflow = ''; M = null; keepY(modalY); };
  const addToCart = () => { const it = item(M.id), mods = []; (it.modifiers || []).forEach(g => (M.sel[g.id] || []).forEach(oi => { const o = g.options[oi]; if (o && !(o.price === 0 && /^No /.test(o.name))) mods.push(o.name); }));
    S.cart.push({ id: M.id, name: it.name, qty: M.qty, unit: lineUnit(it, M.sel), mods, note: M.note.trim() }); saveCart(); closeModal(); toast('Added ' + it.name); track('addtocart'); render(); };

  // ---------- checkout ----------
  const checkout = () => { const s = settings(), t = totals(), c = LS.get('ctq_customer', {});
    if (!S.cart.length) return header() + `<div class="wrap page"><div class="card done"><div class="big">🛒</div><h3>Your cart is empty</h3><a class="btn" href="#/">Back to menu</a></div></div>`;
    const belowMin = false;
    return header() + `<div class="wrap page" style="max-width:640px"><a href="#/" class="fine">← Keep shopping</a><h1 style="margin:0;font-family:Fredoka">Checkout</h1>
      <form id="co" class="page" style="padding:0" data-testid="checkoutform">
      <div class="card"><h3>Pickup 🛍️</h3><p class="fine" style="margin:0">Pick up at ${esc(s.address)}, ready in about ${s.pickupMins} min.</p>
        <label class="f">When<select name="when" data-testid="co-when"><option value="asap">ASAP</option>${laterSlots(s).map(x => `<option>${x}</option>`).join('')}</select></label>${ddBtn(s, 'checkout')}</div>
      <div class="card"><h3>Your info</h3><label class="f">Name<input type="text" name="name" required autocomplete="name" value="${esc(c.name || '')}" data-testid="co-name"></label>
        <div class="two"><label class="f">Phone<input type="tel" name="phone" required autocomplete="tel" value="${esc(c.phone || '')}" data-testid="co-phone"></label><label class="f">Email<input type="email" name="email" autocomplete="email" value="${esc(c.email || '')}" data-testid="co-email"></label></div>
        <label class="f">Order notes<textarea name="notes" rows="2" placeholder="Anything we should know?"></textarea></label></div>
      <div class="card"><h3>Your order</h3>${cartLines()}</div>
      <div class="card"><h3>Tip the crew</h3><div class="tips">${[0, 10, 15, 20].map(p => { const v = r2(t.subtotal * p / 100); return `<button type="button" class="${S.tip === v ? 'on' : ''}" data-act="tip" data-v="${v}">${p ? p + '%' : 'None'}</button>`; }).join('')}</div></div>
      <div class="card"><h3>Payment ${liveCard() || hostedCard() || cardOff() ? '' : '<span class="test" data-testid="demo-pay">Demo mode, no real payments</span>'}</h3><div class="seg">${cardOff() ? '' : '<label><input type="radio" name="pay" value="card" checked data-ch="pay"> 💳 Card</label>'}<label><input type="radio" name="pay" value="store" ${cardOff() ? 'checked' : ''} data-ch="pay" data-testid="co-paystore"> 💵 Pay at pickup</label></div>
        <div id="cardbox">${cardOff() ? '' : liveCard() ? '<div id="stripe-el" data-testid="stripe-element"></div>' : hostedCard() ? '<p class="fine" data-testid="hosted-card">🔒 You\'ll enter your card on Stripe\'s secure checkout page, then come right back here.</p>' : `<label class="f">Card number<input type="text" name="card" inputmode="numeric" value="4242 4242 4242 4242" data-testid="co-card"></label><div class="two"><label class="f">Exp<input type="text" name="exp" value="12/30"></label><label class="f">CVC<input type="text" name="cvc" value="123"></label></div><p class="fine">Demo mode. Use 4242 4242 4242 4242. Nothing is charged.</p>`}</div>
        <div id="payerr" class="req" hidden></div>
        ${sumHtml(t)}
        <button class="btn block" data-testid="placeorder" ${belowMin || !s.acceptOrders ? 'disabled' : ''}>${s.acceptOrders ? 'Place order · ' + m(t.total) : 'Not taking online orders right now'}</button></div>
      </form></div>`; };
  const laterSlots = s => { const h = s.hours[new Date().getDay()]; if (h.closed) return []; const out = []; const d = new Date(); d.setMinutes(Math.ceil((d.getMinutes() + 30) / 15) * 15, 0, 0); for (let i = 0; i < 24; i++) { const t = d.toTimeString().slice(0, 5); if (t >= h.open && t < h.close) out.push('Today ' + fmtT(t)); d.setMinutes(d.getMinutes() + 15); } return out; };

  // Live Stripe (owner connected her account and keys are set): Payment Element in deferred-intent mode.
  const liveCard = () => S.cfg.stripe.mode === 'live' && S.cfg.stripe.connected && S.cfg.stripe.publishableKey;
  const hostedCard = () => S.cfg.stripe.mode === 'live' && S.cfg.stripe.connected && !S.cfg.stripe.publishableKey;
  const cardOff = () => S.cfg.stripe.mode === 'live' && !S.cfg.stripe.connected;
  let SE = null;
  const mountStripe = () => { if (!liveCard() || !$('#stripe-el')) return; const go = () => { const st = Stripe(S.cfg.stripe.publishableKey, { stripeAccount: S.cfg.stripe.account });
      const els = st.elements({ mode: 'payment', amount: Math.round(totals().total * 100), currency: 'usd' }); els.create('payment').mount('#stripe-el'); SE = { st, els }; };
    if (window.Stripe) go(); else { const sc = document.createElement('script'); sc.src = 'https://js.stripe.com/v3/'; sc.onload = go; document.head.appendChild(sc); } };
  const placeOrder = async f => { const s = settings(), t = totals(), d = Object.fromEntries(new FormData(f));
    const err = $('#payerr'), btn = f.querySelector('[data-testid=placeorder]'); err.hidden = true;
    const fail = m => { err.textContent = m; err.hidden = false; btn.disabled = false; };
    btn.disabled = true;
    let payment;
    if (d.pay === 'store') payment = { method: 'store' };
    else if (liveCard()) {
      if (!SE) return fail('Card form is still loading.');
      const sub = await SE.els.submit(); if (sub.error) return fail(sub.error.message);
      const ir = await (await fetch('/api/checkout/intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: S.cart, tip: S.tip }) })).json();
      if (!ir.ok) return fail(ir.error);
      const cr = await SE.st.confirmPayment({ elements: SE.els, clientSecret: ir.clientSecret, redirect: 'if_required' });
      if (cr.error) return fail(cr.error.message);
      payment = { method: 'card', id: cr.paymentIntent.id };
    } else if (hostedCard()) {
      LS.set('ctq_customer', { name: d.name, phone: d.phone, email: d.email });
      LS.set('ctq_pending', { sid: SID, when: d.when, customer: { name: d.name, phone: d.phone, email: d.email }, notes: d.notes || '', tip: S.tip, items: S.cart.map(l => ({ id: l.id, qty: l.qty, mods: l.mods, note: l.note })) });
      let cr; try { cr = await (await fetch('/api/checkout/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: S.cart, tip: S.tip }) })).json(); } catch (e) { return fail('Could not reach us. Check your connection and try again.'); }
      if (!cr.ok) return fail(cr.error || 'Card payment is not available right now.');
      location.href = cr.url; return;
    } else if (cardOff()) { return fail('Card payments are not set up yet. Choose pay at pickup.');
    } else { const pay = PAY.charge({ amount: t.total, method: 'card', card: d.card }); if (!pay.ok) return fail(pay.error); payment = { method: 'card', id: pay.id, last4: pay.last4 }; }
    LS.set('ctq_customer', { name: d.name, phone: d.phone, email: d.email });
    const body = { sid: SID, when: d.when, customer: { name: d.name, phone: d.phone, email: d.email }, notes: d.notes || '', tip: S.tip, payment, items: S.cart.map(l => ({ id: l.id, qty: l.qty, mods: l.mods, note: l.note })) };
    return submitOrder(body, fail); };
  const submitOrder = async (body, fail) => {
    let r;
    try { r = await (await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); } catch (e) { return fail('Could not reach us. Check your connection and try again.'); }
    if (!r.ok) return fail(r.error || 'Something went wrong.');
    const mine = myOrders(); mine[r.id] = r.token; LS.set('ctq_my_orders', mine);
    S.conf[r.id] = r.order;
    if (r.email && r.email.browserSend) { try { const b = r.email.browserSend; if (/^https:\/\/formspree\.io\/f\//.test(b.url)) fetch(b.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(b.fields) }); } catch (e) {} }
    S.cart = []; S.tip = 0; saveCart(); localStorage.removeItem('ctq_pending'); location.hash = '#/order/' + r.id; };
  // Back from Stripe Checkout: turn the paid session into the order.
  const finishPaid = async () => { const cs = (location.hash.match(/cs=([A-Za-z0-9_]+)/) || [])[1], pend = LS.get('ctq_pending', null);
    if (!cs || !pend) { location.hash = '#/checkout'; return; }
    await submitOrder(Object.assign({}, pend, { payment: { method: 'card', session: cs } }), m => { $('#app').innerHTML = header() + `<div class="wrap page"><div class="card"><h3>Payment received, order not saved</h3><p>${esc(m)}</p><p>Please call us so we can sort it out.</p><a class="btn ghost" href="#/">Back to menu</a></div></div>`; }); };

  // Customer confirmation: polls the server so the owner's updates show up live.
  let pollT = null;
  const loadConf = async id => { const t = myOrders()[id]; if (!t) return; try { const r = await (await fetch('/api/orders/' + encodeURIComponent(id) + '?t=' + t)).json(); if (r.ok) { const was = JSON.stringify(S.conf[id]); S.conf[id] = r.order; if (was !== JSON.stringify(r.order) && location.hash === '#/order/' + id) render(); } } catch (e) {} };
  const pollConf = id => { clearInterval(pollT); pollT = setInterval(() => { if (location.hash !== '#/order/' + id) return clearInterval(pollT); const o = S.conf[id]; if (o && /completed|canceled/.test(o.status) && !(o.refunded > 0 && o.status !== 'canceled')) return clearInterval(pollT); loadConf(id); }, 6000); };
  const STATUS = { new: 'Order received', preparing: 'Being made', ready: 'Ready for pickup!', completed: 'Picked up. Enjoy!', canceled: 'Canceled' };
  const confirmation = id => { const o = S.conf[id], s = settings();
    if (!o) { if (myOrders()[id]) { loadConf(id); return header() + '<div class="wrap page"><div class="card">Loading your order...</div></div>'; } return header() + '<div class="wrap page"><div class="card">Order not found. <a href="#/">Menu</a></div></div>'; }
    pollConf(id);
    const st = ['new', 'preparing', 'ready'], k = o.status === 'completed' ? 3 : st.indexOf(o.status), cx = o.status === 'canceled';
    const full = o.refunded > 0 && o.refunded >= o.total - 0.001;
    return header() + `<div class="wrap page" style="max-width:600px"><div class="card done ${cx ? 'cx' : ''}" data-testid="confirmation"><div class="big">${cx ? '😕' : o.status === 'ready' ? '🛍️' : '🎉'}</div><h2 style="margin:0">${cx ? `Order #${esc(o.id)} was canceled` : `Order placed! Thanks, ${esc(o.customer.name.split(' ')[0])}. Order #${esc(o.id)} is in.`}</h2>
      <p class="mut" style="margin:0" data-testid="conf-name">${esc(s.name)}</p>
      ${cx ? `<p style="margin:0" data-testid="cancel-reason">Reason: ${esc(o.cancelReason)}</p>` : `<p class="mut" style="margin:0">Pickup at ${esc(s.address)} in about ${s.pickupMins} min. ${o.when !== 'asap' ? '(' + esc(o.when) + ')' : ''}</p>
      <div class="steps">${st.map((x, i) => `<div class="${i <= k ? 'on' : ''}"></div>`).join('')}</div>`}
      <b data-testid="orderstatus" class="ostat ${o.status}">${STATUS[o.status] || esc(o.status)}</b>
      ${o.refunded > 0 ? `<span class="test" data-testid="refund-note">${full ? 'Refunded' : 'Partly refunded'}: ${m(o.refunded)} back to your ${o.payment.method === 'store' ? 'hand (cash)' : 'card'}</span>` : ''}
      <span class="fine" data-testid="placed">${esc(o.payment.label)} · updates live on this page</span></div>
      <div class="card"><h3>Receipt</h3>${o.items.map(l => `<div class="line"><div class="grow"><b>${l.qty} × ${esc(l.name)}</b>${l.mods.length ? `<small>${esc(l.mods.join(', '))}</small>` : ''}</div><b>${m(l.lineTotal)}</b></div>`).join('')}
      <div class="sum"><div><span>Subtotal</span><span>${m(o.subtotal)}</span></div><div><span>Tax</span><span>${m(o.tax)}</span></div>${o.tip ? `<div><span>Tip</span><span>${m(o.tip)}</span></div>` : ''}<div class="tot"><span>Total</span><span data-testid="conf-total">${m(o.total)}</span></div>${o.refunded > 0 ? `<div><span>Refunded</span><span>−${m(o.refunded)}</span></div>` : ''}</div></div>
      <div class="card"><p style="margin:0">Questions? Call <a href="tel:${s.phone.replace(/\D/g, '')}">${esc(s.phone)}</a></p><a class="btn ghost" href="#/">Back to menu</a></div></div>`; };

  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -40px 0px' }) : null;
  // Reveal animations play once per visit. Re-renders (add to cart, qty, chips) must not blank and re-fade the page.
  let revealedOnce = false; const seenRoutes = new Set();
  const reveal = () => { const r = (location.hash || '#/').split('?')[0]; const again = seenRoutes.has(r); seenRoutes.add(r);
    document.querySelectorAll('.reveal').forEach(el => { if (again || !io) el.classList.add('in', 'now'); else io.observe(el); }); };
  const keepY = y => { const h = document.documentElement, b = h.style.scrollBehavior; h.style.scrollBehavior = 'auto'; window.scrollTo(0, y); h.style.scrollBehavior = b; };
  // ---------- router ----------
  let lastRoute = null;
  const render = () => { const h = location.hash || '#/'; let html;
    if (h.startsWith('#/paid')) { $('#app').innerHTML = header() + '<div class="wrap page"><div class="card" data-testid="paying">Finishing your order...</div></div>'; finishPaid(); return; }
    if (h.startsWith('#/checkout')) html = checkout(); else if (h.startsWith('#/order/')) html = confirmation(h.slice(8)); else html = store();
    if (h.startsWith('#/checkout') && S.cart.length) track('checkout', true);
    const old = $('#co'), keep = old ? [...old.elements].filter(x => x.name && x.type !== 'radio').map(x => [x.name, x.value]) : null;
    const route = h.split('?')[0], sameRoute = route === lastRoute, y = window.scrollY; lastRoute = route;
    $('#app').innerHTML = html;
    reveal(); if (sameRoute) keepY(y);
    mountStripe(); watchMenu();
    const nf = $('#co'); if (keep && nf) keep.forEach(([k, v]) => { const x = nf.elements[k]; if (x && x.type !== 'radio' && x.tagName !== 'BUTTON') x.value = v; }); };
  window.addEventListener('hashchange', () => { if (!/^#c-|^#menu/.test(location.hash)) { const was = lastRoute; render(); if (lastRoute !== was) keepY(0); } });

  document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el) { if (e.target.id === 'modal') closeModal(); return; } const a = el.dataset.act, s = settings();
    if (el.tagName === 'BUTTON' && el.type === 'submit') e.preventDefault(); // action buttons inside the checkout form must not submit it
    if (a === 'open') openItem(el.dataset.id); else if (a === 'close') closeModal(); else if (a === 'add') addToCart();
    else if (a === 'mq') { M.qty = Math.max(1, M.qty + +el.dataset.d); renderModal(); }
    else if (a === 'mode') { S.mode = el.dataset.v; saveCart(); render(); }
    else if (a === 'cart') { location.hash = '#/checkout'; }
    else if (a === 'inc' || a === 'dec' || a === 'rm') { const l = S.cart[+el.dataset.i]; if (a === 'inc') l.qty++; else if (a === 'dec') l.qty--; if (a === 'rm' || l.qty < 1) S.cart.splice(+el.dataset.i, 1); saveCart(); render(); }
    else if (a === 'tip') { S.tip = +el.dataset.v; render(); }
    else if (a === 'cat') { document.querySelectorAll('.catnav a').forEach(x => x.classList.toggle('on', x === el)); }
  });
  document.addEventListener('change', e => { const el = e.target;
    if (el.dataset.g && M) { const g = item(M.id).modifiers.find(x => x.id === el.dataset.g), oi = +el.dataset.oi; if (g.type === 'single') M.sel[g.id] = [oi]; else { const s = M.sel[g.id] || []; M.sel[g.id] = el.checked ? s.concat(oi) : s.filter(x => x !== oi); } renderModal(); }
    else if (el.dataset.ch === 'mode') { S.mode = el.value; saveCart(); render(); }
    else if (el.dataset.ch === 'pay') { $('#cardbox').hidden = el.value !== 'card'; }
  });
  document.addEventListener('input', e => { const el = e.target; if (el.dataset.in === 'q') { S.q = el.value; const pos = el.selectionStart; render(); const n = $('[data-in=q]'); n.focus(); n.setSelectionRange(pos, pos); } else if (el.dataset.in === 'note' && M) M.note = el.value; });
  document.addEventListener('submit', e => { e.preventDefault(); const f = e.target;
    if (f.id === 'co') placeOrder(f);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && M) closeModal(); });

  window.CTQ = { totals, lineUnit, openNow };
  let menuObs = null;
  const watchMenu = () => { const el = $('#menu'); if (!el || sent.menuview) return; if (!('IntersectionObserver' in window)) return; if (menuObs) menuObs.disconnect();
    menuObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { track('menuview', true); menuObs.disconnect(); } }); menuObs.observe(el); };
  document.addEventListener('click', e => { if (e.target.closest('[data-act=open],[data-act=tomenu],[data-act=cat]')) track('menuview', true); }, true);
  // Old #/admin links go to the storefront; the owner dashboard lives at /owner.
  if (/^#\/admin/.test(location.hash)) history.replaceState(null, '', location.pathname);
  track('pageview');
  // Live-now heartbeat: anonymous sid, current page and cart size. No names, no IPs stored.
  let typed = false;
  document.addEventListener('focusin', e => { if (e.target.closest && e.target.closest('#co')) { if (!typed) { typed = true; beat(); } } });
  const livePage = () => { const h = location.hash || '#/'; if (h.startsWith('#/checkout')) return S.cart.length && typed ? 'checkout' : 'cart'; if (h.startsWith('#/order/') || h.startsWith('#/paid')) return 'order'; return 'menu'; };
  const beat = () => { if (document.visibilityState === 'hidden') return; try { fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ sid: SID, page: livePage(), items: count() }) }).catch(() => {}); } catch (e) {} };
  window.addEventListener('hashchange', () => { if (!(location.hash || '').startsWith('#/checkout')) typed = false; setTimeout(beat, 50); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); else if (navigator.sendBeacon) navigator.sendBeacon('/api/live', new Blob([JSON.stringify({ sid: SID, gone: true })], { type: 'application/json' })); });
  setInterval(beat, 20000); beat();
  window.addEventListener('ctq-cart', beat);
  Promise.all([fetch('/menu.json').then(r => r.json()), fetch('/api/site').then(r => r.json()).catch(() => null)]).then(([d, c]) => { S.menu = d; if (c) S.cfg = c; render(); });
})();
