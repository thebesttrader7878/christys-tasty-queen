// Owner dashboard for Kimmie’s-Christy's Tasty Queen. Talks only to /api/owner/* and /api/admin/* (session cookie).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const m = n => '$' + (+n || 0).toFixed(2);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const STATUS = { new: 'New', preparing: 'Making', ready: 'Ready', completed: 'Picked up', canceled: 'Canceled' };
  const NEXT = { new: ['preparing', 'Accept'], preparing: ['ready', 'Mark ready'], ready: ['completed', 'Picked up'] };
  const TABS = [['orders', 'Orders', '🧾'], ['analytics', 'Stats', '📈'], ['reports', 'Reports', '📄'], ['menu', 'Menu', '🍔'], ['settings', 'Settings', '⚙️']];
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const S = { me: null, tab: 'orders', orders: [], filter: 'active', open: null, seen: null, unseen: 0, an: null, rep: null, from: addDays(today(), -6), to: today(), settings: null, edits: {}, menu: null, stripe: null, sheet: null, err: '' };

  const api = async (path, opt = {}) => {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opt, opt.body ? { body: JSON.stringify(opt.body) } : {}));
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status === 401 && !path.startsWith('/api/owner/login')) { S.me = null; render(); throw new Error('Signed out'); }
    if (!r.ok || j.ok === false) { const e = new Error(j.error || 'Something went wrong (' + r.status + ')'); e.status = r.status; throw e; }
    return j;
  };
  const toast = t => { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); };
  const fmtTime = iso => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  const fmtDay = iso => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' });
  const ago = iso => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : fmtDay(iso) + ' ' + fmtTime(iso); };

  // New-order chime (Web Audio, no files). Browsers only allow sound after a tap, so we unlock on first tap.
  let actx = null; document.addEventListener('pointerdown', () => { if (!actx) try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }, { once: false });
  const chime = () => { window.__chimes = (window.__chimes || 0) + 1; if (!actx) return; [880, 1175, 1568].forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; o.connect(g); g.connect(actx.destination); const t = actx.currentTime + i * .16; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.3, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .3); o.start(t); o.stop(t + .32); }); };

  // ---------- login ----------
  const login = () => `<main class="login"><img src="/img/logo-180.jpg" alt="" class="logo"><h1>Owner login</h1><p class="mut">Kimmie’s-Christy's Tasty Queen</p>
    <form id="loginf" class="card" novalidate><label>Email<input type="email" name="email" autocomplete="username" required value="${esc(S.email || '')}" data-testid="login-email"></label>
    <label>Password<input type="password" name="password" autocomplete="current-password" required data-testid="login-pass"></label>
    <p class="err" data-testid="login-err" ${S.err ? '' : 'hidden'}>${esc(S.err)}</p><button class="btn" data-testid="login-btn">Log in</button></form>
    <p class="fine">Customers can’t see this page. <a href="/">Back to the store</a></p></main>`;

  // ---------- orders ----------
  const FILTERS = [['active', 'Active'], ['new', 'New'], ['preparing', 'Making'], ['ready', 'Ready'], ['completed', 'Done'], ['canceled', 'Canceled'], ['all', 'All']];
  const shown = () => S.orders.filter(o => S.filter === 'all' ? true : S.filter === 'active' ? ['new', 'preparing', 'ready'].includes(o.status) : o.status === S.filter);
  const orderCard = o => `<button class="ocard st-${o.status}" data-act="open" data-id="${esc(o.id)}" data-testid="order-${esc(o.id)}">
    <div class="row"><b>#${esc(o.id)} · ${esc(o.customer.name)}</b><span class="pill ${o.status}">${STATUS[o.status]}</span></div>
    <div class="row mut"><span>${o.items.reduce((a, l) => a + l.qty, 0)} items · ${o.when === 'asap' ? 'ASAP' : esc(o.when)}</span><b>${m(o.total)}</b></div>
    <div class="row fine"><span>${ago(o.created)}</span><span>${o.payment.method === 'store' ? 'Pay at pickup' : 'Paid by card'}${o.refunded ? ' · refunded ' + m(o.refunded) : ''}</span></div></button>`;
  const orders = () => { const list = shown(), cnt = k => S.orders.filter(o => k === 'active' ? ['new', 'preparing', 'ready'].includes(o.status) : k === 'all' || o.status === k).length;
    return `<div class="chips" role="tablist" data-testid="filters">${FILTERS.map(([k, l]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}" data-testid="filter-${k}">${l} <small>${cnt(k)}</small></button>`).join('')}</div>
    <div class="list" data-testid="order-list">${list.length ? list.map(orderCard).join('') : `<div class="empty">No ${S.filter === 'all' ? '' : FILTERS.find(f => f[0] === S.filter)[1].toLowerCase()} orders right now. New ones pop up here with a ding.</div>`}</div>`; };

  const detail = o => { const left = +(o.total - (o.refunded || 0)).toFixed(2), canRefund = left > 0 && (o.payment.method === 'card' || o.status === 'completed'), tel = (o.customer.phone || '').replace(/\D/g, '');
    return `<div class="sheet" data-testid="order-detail"><div class="sheethead"><button class="x" data-act="close" aria-label="Close">✕</button><h2>Order #${esc(o.id)}</h2><span class="pill ${o.status}" data-testid="detail-status">${STATUS[o.status]}</span></div>
    <div class="card"><div class="row"><b data-testid="detail-name">${esc(o.customer.name)}</b><a class="btn sm" href="tel:${tel}" data-testid="detail-call">📞 ${esc(o.customer.phone)}</a></div>
      ${o.customer.email ? `<div class="fine">${esc(o.customer.email)}</div>` : ''}<div class="fine">Placed ${fmtDay(o.created)} ${fmtTime(o.created)} · Pickup ${o.when === 'asap' ? 'ASAP' : esc(o.when)}</div></div>
    <div class="card">${o.items.map(l => `<div class="line"><div><b>${l.qty} × ${esc(l.name)}</b>${l.mods.length ? `<small>${esc(l.mods.join(', '))}</small>` : ''}${l.note ? `<small class="note">Note: ${esc(l.note)}</small>` : ''}</div><b>${m(l.lineTotal)}</b></div>`).join('')}
      ${o.notes ? `<div class="note big">Order note: ${esc(o.notes)}</div>` : ''}
      <div class="sum"><div><span>Subtotal</span><span>${m(o.subtotal)}</span></div><div><span>Tax</span><span>${m(o.tax)}</span></div>${o.tip ? `<div><span>Tip</span><span>${m(o.tip)}</span></div>` : ''}<div class="tot"><span>Total</span><span data-testid="detail-total">${m(o.total)}</span></div>
      ${o.refunded ? `<div class="red"><span>Refunded</span><span data-testid="detail-refunded">−${m(o.refunded)}</span></div>` : ''}</div>
      <div class="fine" data-testid="detail-pay">${esc(o.payment.label)}${o.payment.demo ? ' · demo, no real money moved' : ''}</div></div>
    ${o.status === 'canceled' ? `<div class="card red">Canceled: ${esc(o.cancelReason)}</div>` : ''}
    ${NEXT[o.status] ? `<button class="btn big" data-act="status" data-v="${NEXT[o.status][0]}" data-testid="next-status">${NEXT[o.status][1]}</button>` : ''}
    <div class="two">${['new', 'preparing', 'ready'].includes(o.status) ? `<button class="btn ghost" data-act="sheet" data-v="cancel" data-testid="cancel-open">Cancel order</button>` : ''}
      ${canRefund ? `<button class="btn ghost" data-act="sheet" data-v="refund" data-testid="refund-open">Refund</button>` : ''}</div>
    ${S.sheet === 'cancel' ? `<form id="cancelf" class="card" data-testid="cancel-form"><label>Why? (the customer sees this)<input name="reason" required maxlength="200" placeholder="Out of buns, closing early..." data-testid="cancel-reason"></label>
      ${o.payment.method === 'card' && left > 0 ? `<p class="fine">Their card gets ${m(left)} back automatically.</p>` : ''}<button class="btn danger" data-testid="cancel-confirm">Cancel order</button></form>` : ''}
    ${S.sheet === 'refund' ? `<form id="refundf" class="card" data-testid="refund-form"><p class="fine">Up to ${m(left)} left to refund${o.payment.method === 'store' ? ' (cash, hand it back at the window)' : ' to their card'}.</p>
      <div class="two"><label><input type="radio" name="kind" value="full" checked data-testid="refund-full"> Full ${m(left)}</label><label><input type="radio" name="kind" value="part" data-testid="refund-part"> Part</label></div>
      <label>Amount<input name="amount" inputmode="decimal" placeholder="0.00" data-testid="refund-amount"></label><label>Reason (optional)<input name="reason" maxlength="200" data-testid="refund-reason"></label>
      <button class="btn danger" data-testid="refund-confirm">Refund</button></form>` : ''}
    ${o.refunds && o.refunds.length ? `<div class="card"><h3>Refunds</h3>${o.refunds.map(r => `<div class="row fine"><span>${fmtDay(r.at)} ${fmtTime(r.at)}${r.reason ? ' · ' + esc(r.reason) : ''}</span><b>${m(r.amount)}</b></div>`).join('')}</div>` : ''}
    <div class="card"><h3>History</h3>${(o.log || []).map(l => `<div class="row fine"><span>${fmtTime(l.at)}</span><span>${l.status === 'refund' ? 'Refund ' + m(l.amount) : STATUS[l.status] || esc(l.status)}${l.note ? ': ' + esc(l.note) : ''}</span></div>`).join('')}</div></div>`; };

  const PRESETS = [['today', 'Today', 0, 0], ['yesterday', 'Yesterday', -1, -1], ['7d', 'Last 7 days', -6, 0], ['30d', 'Last 30 days', -29, 0]];
  const nice = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  const rangeLabel = () => S.from === S.to ? nice(S.from) : nice(S.from) + ' to ' + nice(S.to);
  const rangePicker = () => { const t = today(); const cur = (PRESETS.find(([, , a, b]) => S.from === addDays(t, a) && S.to === addDays(t, b)) || [])[0];
    return `<form id="rangef" class="card" data-testid="range-picker"><div class="chips">${PRESETS.map(([k, l]) => `<button type="button" class="chip ${cur === k ? 'on' : ''}" data-act="preset" data-v="${k}" data-testid="preset-${k}">${l}</button>`).join('')}</div>
      <div class="two"><label>Start<input type="date" name="from" value="${S.from}" max="${t}" required data-testid="rep-from"></label><label>End<input type="date" name="to" value="${S.to}" max="${t}" required data-testid="rep-to"></label></div>
      <button class="btn" data-testid="rep-run">Show these days</button><p class="fine" data-testid="range-label">Showing ${esc(rangeLabel())} · Kansas City time</p></form>`; };
  // ---------- analytics ----------
  const bars = (rows, testid) => { const mx = Math.max(1, ...rows.map(r => r[1])); return `<div class="bars" data-testid="${testid}">${rows.map(([l, v, t]) => `<div class="bar"><span>${esc(l)}</span><div><i style="width:${Math.max(2, v / mx * 100)}%"></i></div><b>${t != null ? t : v}</b></div>`).join('')}</div>`; };
  const analytics = () => { const a = S.an;
    const rg = rangePicker();
    if (!a) return rg + '<div class="empty">Loading...</div>';
    const hours = a.byHour.map((v, h) => [h, v]).filter(([h, v]) => v || (h >= 9 && h <= 20)).map(([h, v]) => [(h % 12 || 12) + (h < 12 ? 'a' : 'p'), v]);
    return rg + `<div class="kpis"><div class="kpi"><small>Revenue</small><b data-testid="kpi-revenue">${m(a.revenue)}</b></div><div class="kpi"><small>Orders</small><b data-testid="kpi-orders">${a.orders}</b></div>
      <div class="kpi"><small>Avg order</small><b data-testid="kpi-avg">${m(a.avgOrder)}</b></div><div class="kpi"><small>Refunds</small><b data-testid="kpi-refunds">${m(a.refunds)}</b><small>${a.refundCount} orders</small></div><div class="kpi"><small>Canceled</small><b data-testid="kpi-canceled">${a.canceled}</b></div><div class="kpi"><small>Conversion</small><b data-testid="kpi-conv">${a.conversion}%</b><small>orders ÷ visitors</small></div></div>
      <div class="card"><h3>Top items</h3>${a.topItems.length ? bars(a.topItems.map(i => [i.item, i.sales, `${i.qty} · ${m(i.sales)}`]), 'top-items') : '<p class="fine">No sales yet.</p>'}</div>
      <div class="card"><h3>Orders by hour</h3>${bars(hours, 'by-hour')}</div>
      <div class="card"><h3>Visitors to orders</h3><p class="fine">Counted on this site only, no outside trackers. ${a.pageViews} page views.</p>${bars(a.funnel.map(([l, v]) => [l, v]), 'funnel')}</div>
      <p class="fine">Revenue counts what you keep: totals minus refunds, canceled orders left out.</p>`; };

  // ---------- reports ----------
  const reports = () => { const r = S.rep, s = r && r.summary, q = `from=${S.from}&to=${S.to}`;
    return `${rangePicker()}
    ${s ? `<div class="card" data-testid="report"><h3>${esc(r.from === r.to ? nice(r.from) : nice(r.from) + ' to ' + nice(r.to))}</h3>
      <div class="sum"><div><span>Orders</span><span data-testid="rep-orders">${s.orders}</span></div><div><span>Canceled</span><span>${s.canceled}</span></div><div><span>Sales (food)</span><span data-testid="rep-subtotal">${m(s.subtotal)}</span></div><div><span>Tax collected</span><span>${m(s.tax)}</span></div><div><span>Tips</span><span>${m(s.tips)}</span></div><div><span>Gross</span><span data-testid="rep-gross">${m(s.gross)}</span></div><div class="red"><span>Refunds</span><span data-testid="rep-refunds">−${m(s.refunds)}</span></div><div class="tot"><span>Net</span><span data-testid="rep-net">${m(s.revenue)}</span></div><div><span>Card fees (est.)</span><span>${m(s.cardFees)}</span></div></div>
      ${Object.entries(s.byPayment).map(([k, v]) => `<div class="row fine"><span>${esc(k)}</span><span>${v.orders} · ${m(v.total)}</span></div>`).join('')}</div>
      <div class="card"><h3>Item sales</h3>${s.items.length ? s.items.map(i => `<div class="row"><span>${esc(i.item)}</span><span>${i.qty} · <b>${m(i.sales)}</b></span></div>`).join('') : '<p class="fine">Nothing sold in this range.</p>'}</div>` : ''}
    <div class="two"><a class="btn ghost" href="/api/admin/export/orders.csv?${q}" download data-testid="csv-orders">⬇ Orders CSV</a><a class="btn ghost" href="/api/admin/export/items.csv?${q}" download data-testid="csv-items">⬇ Item sales CSV</a></div>`; };

  // ---------- menu ----------
  const menuTab = () => { if (!S.menu) return '<div class="empty">Loading...</div>';
    return `<p class="fine">Changes show on the store right away.</p>${S.menu.categories.map(c => `<div class="card"><h3>${esc(c.name)}</h3>${c.items.map(id => { const it = S.menu.items[id], e = S.edits[id] || {}; if (!it) return '';
      const base = it.price || 0; return `<div class="mrow" data-testid="menu-${esc(id)}"><div class="grow"><b>${esc(it.name)}</b>${base ? `<label class="price">$<input type="number" step="0.01" min="0" value="${(e.price != null ? e.price : base).toFixed(2)}" data-ed="price" data-id="${esc(id)}" data-testid="price-${esc(id)}"></label>` : '<small class="fine">priced by size</small>'}</div>
      <label class="tog"><input type="checkbox" data-ed="soldOut" data-id="${esc(id)}" ${e.soldOut ? 'checked' : ''} data-testid="soldout-${esc(id)}"> Sold out</label><label class="tog"><input type="checkbox" data-ed="hidden" data-id="${esc(id)}" ${e.hidden ? 'checked' : ''}> Hide</label></div>`; }).join('')}</div>`).join('')}
    <button class="btn ghost" data-act="resetmenu" data-testid="menu-reset">Undo all menu changes</button>`; };

  // ---------- settings + get paid ----------
  const pay = () => { const st = S.stripe; if (!st) return '';
    const on = st.status === 'connected', demo = st.mode !== 'live';
    return `<section class="card pay" id="pay" data-testid="getpaid"><h2>Get paid</h2>
      ${demo ? '<span class="demo" data-testid="demo-badge">Demo mode, no real payments</span>' : ''}
      <div class="pstat ${on ? 'on' : ''}" data-testid="stripe-status">${on ? '✅ Connected, payouts on' : '⚪ Not connected'}</div>
      <p class="mut" data-testid="stripe-explain">${on ? 'Card orders go straight to your Stripe account and Stripe sends the money to your bank.' : 'Connect Stripe so card orders land in your bank account. Takes about 5 minutes.'}</p>
      ${on ? `<p class="fine">Account ${esc(st.account)}${st.connectedAt ? ' · since ' + fmtDay(st.connectedAt) : ''}</p><button class="btn ghost" data-act="disconnect" data-testid="stripe-disconnect">Disconnect</button>`
           : `<a class="btn stripe" href="/api/admin/stripe/connect" data-testid="stripe-connect">Connect with Stripe</a>`}
      ${demo ? '<p class="fine">This is a practice run. Real payouts turn on once your Stripe account is linked.</p>' : ''}</section>`; };
  const settings = () => { const s = S.settings; if (!s) return '<div class="empty">Loading...</div>';
    return pay() + `<form id="setf" class="card" data-testid="settings-form"><h2>Store</h2>
      <label class="tog big"><input type="checkbox" name="acceptOrders" ${s.acceptOrders ? 'checked' : ''} data-testid="set-accept"> Taking online orders</label>
      <h3>Hours</h3>${s.hours.map((h, i) => `<div class="hrow"><b>${DAYS[i]}</b><input type="time" name="o${i}" value="${h.open}" data-testid="open-${i}"><input type="time" name="c${i}" value="${h.close}" data-testid="close-${i}"><label class="tog"><input type="checkbox" name="x${i}" ${h.closed ? 'checked' : ''} data-testid="closed-${i}"> Closed</label></div>`).join('')}
      <div class="two"><label>Pickup time (min)<input type="number" name="pickupMins" min="1" max="180" value="${s.pickupMins}" data-testid="set-pickup"></label><label>Sales tax %<input type="number" step="0.001" name="taxRate" value="${s.taxRate}"></label></div>
      <label>DoorDash link<input name="doordashUrl" value="${esc(s.doordashUrl)}"></label>
      <button class="btn" data-testid="set-save">Save</button></form>
      <div class="card"><h3>Where order alerts go</h3><p class="fine" data-testid="webhook-current">${esc(S.webhook || 'not set')}</p><p class="fine">Want alerts sent somewhere else? Ask your web person to switch it.</p></div>
      <div class="card" data-testid="push-card"><h3>Phone alerts</h3>${S.push && S.push.ready ? `<p class="fine">Get a buzz on your phone for every new order. Free.</p>
      <ol class="steps"><li>Install the free <b>ntfy</b> app (App Store or Google Play).</li><li>Open this link on your phone, or in the app tap + and type the topic below: <a href="${esc(S.push.url)}" target="_blank" rel="noopener" data-testid="push-link">Subscribe to alerts</a></li><li>Tap <b>Send test alert</b> and check your phone.</li></ol>
      <p class="fine">Topic: <code data-testid="push-topic">${esc(S.push.topic)}</code><br>Keep it private. Anyone with it can see order alerts.</p>
      <button class="btn" data-act="pushtest" data-testid="push-test">Send test alert</button>` : '<div class="pstat" data-testid="push-status">⚪ Not set up yet</div><p class="fine">Ask your web person to turn on phone alerts.</p>'}</div>
      <div class="card"><p class="fine">Signed in as ${esc(S.me.email)}</p><button class="btn ghost" data-act="logout" data-testid="logout">Log out</button></div>`; };

  // ---------- shell ----------
  const render = () => { const app = $('#app');
    if (!S.me) { app.innerHTML = login(); document.title = 'Owner login'; return; }
    const o = S.open && S.orders.find(x => x.id === S.open), y = window.scrollY;
    const body = { orders, analytics, reports, menu: menuTab, settings }[S.tab]();
    const nNew = S.orders.filter(x => x.status === 'new').length;
    document.title = (nNew ? `(${nNew}) ` : '') + 'Orders · Owner';
    app.innerHTML = `<header class="top"><b>Owner dashboard</b><span class="fine">Kimmie’s-Christy's Tasty Queen</span></header>
      <main class="main" data-testid="tab-${S.tab}">${body}</main>
      <nav class="tabs" data-testid="tabbar">${TABS.map(([k, l, i]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}" data-testid="tab-btn-${k}"><span>${i}</span>${l}${k === 'orders' && nNew ? `<em class="badge" data-testid="badge">${nNew}</em>` : ''}</button>`).join('')}</nav>
      ${o ? `<div class="scrim" data-act="close"></div>${detail(o)}` : ''}`;
    if (!o) window.scrollTo(0, y); };

  const loadOrders = async quiet => { try { const r = await api('/api/admin/orders'); const ids = new Set(S.orders.map(o => o.id));
      const fresh = r.orders.filter(o => o.status === 'new' && !ids.has(o.id));
      const sig = JSON.stringify(r.orders), changed = sig !== S.sig; S.sig = sig; S.orders = r.orders;
      if (quiet && !changed) return;
      if (S.seen && fresh.length) { chime(); toast(fresh.length === 1 ? `New order #${fresh[0].id} from ${fresh[0].customer.name}` : `${fresh.length} new orders`); }
      S.seen = true; if (!quiet || !document.activeElement || !document.activeElement.matches('input,textarea,select')) render(); } catch (e) {} };
  const loadTab = async () => { try {
    if (S.tab === 'analytics') { S.an = null; render(); S.an = await api(`/api/admin/analytics?from=${S.from}&to=${S.to}`); }
    if (S.tab === 'reports') S.rep = await api(`/api/admin/report?from=${S.from}&to=${S.to}`);
    if (S.tab === 'menu') { if (!S.menu) S.menu = await (await fetch('/menu.json')).json(); const r = await api('/api/admin/settings'); S.edits = r.menuEdits; }
    if (S.tab === 'settings') { const [r, st] = await Promise.all([api('/api/admin/settings'), api('/api/admin/stripe')]); S.settings = r.settings; S.webhook = r.webhook; S.stripe = st; S.push = await api('/api/admin/push').catch(() => null); }
    render(); } catch (e) { if (S.me) toast(e.message); } };
  let poll = null;
  const start = async () => { render(); await loadOrders(); loadTab(); clearInterval(poll); poll = setInterval(() => { if (S.me) loadOrders(true); }, 5000); };

  const fromHash = () => { const h = location.hash.slice(1); const [t, q] = h.split('?'); if (t === 'pay') S.tab = 'settings'; else if (TABS.some(x => x[0] === t)) S.tab = t;
    if (q && /stripe=connected/.test(q)) setTimeout(() => toast('Stripe connected'), 300); else if (q && /stripe=/.test(q)) setTimeout(() => toast('Stripe did not connect. Try again.'), 300); };

  const act = async (a, el) => { try {
    if (a === 'tab') { S.tab = el.dataset.v; S.open = null; history.replaceState(null, '', '#' + S.tab); window.scrollTo(0, 0); render(); loadTab(); }
    else if (a === 'filter') { S.filter = el.dataset.v; render(); }
    else if (a === 'open') { S.open = el.dataset.id; S.sheet = null; render(); }
    else if (a === 'close') { S.open = null; render(); }
    else if (a === 'sheet') { S.sheet = S.sheet === el.dataset.v ? null : el.dataset.v; render(); const f = $(S.sheet === 'cancel' ? '#cancelf input' : '#refundf'); if (f) f.scrollIntoView({ block: 'center' }); }
    else if (a === 'status') { el.disabled = true; const r = await api(`/api/admin/orders/${encodeURIComponent(S.open)}/status`, { method: 'POST', body: { status: el.dataset.v } }); upd(r.order); toast(STATUS[r.order.status]); }
    else if (a === 'preset') { const p = PRESETS.find(x => x[0] === el.dataset.v); S.from = addDays(today(), p[2]); S.to = addDays(today(), p[3]); S.rep = null; S.an = null; render(); loadTab(); }
    else if (a === 'resetmenu') { if (!confirm('Put every price and item back the way it was?')) return; await api('/api/admin/menu', { method: 'DELETE' }); toast('Menu reset'); loadTab(); }
    else if (a === 'disconnect') { if (!confirm('Disconnect Stripe? Card orders stop until you connect again.')) return; await api('/api/admin/stripe/disconnect', { method: 'POST' }); toast('Stripe disconnected'); loadTab(); }
    else if (a === 'pushtest') { el.disabled = true; await api('/api/admin/push/test', { method: 'POST' }); toast('Test alert sent. Check your phone.'); el.disabled = false; }
    else if (a === 'logout') { await api('/api/owner/logout', { method: 'POST' }); S.me = null; S.orders = []; S.seen = null; clearInterval(poll); render(); }
  } catch (e) { toast(e.message); if (el) el.disabled = false; } };
  const upd = o => { const i = S.orders.findIndex(x => x.id === o.id); if (i >= 0) S.orders[i] = o; S.sheet = null; render(); };

  document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el) return; e.preventDefault(); act(el.dataset.act, el); });
  document.addEventListener('change', async e => { const el = e.target; if (!el.dataset.ed) return; const id = el.dataset.id, k = el.dataset.ed;
    try { const r = await api('/api/admin/menu/' + encodeURIComponent(id), { method: 'PUT', body: { [k]: k === 'price' ? +el.value : el.checked } }); S.edits[id] = r.edit; toast(k === 'price' ? 'Price saved' : k === 'soldOut' ? (el.checked ? 'Marked sold out' : 'Back on the menu') : (el.checked ? 'Hidden from store' : 'Showing on store')); }
    catch (er) { toast(er.message); loadTab(); } });
  document.addEventListener('submit', async e => { e.preventDefault(); const f = e.target, d = Object.fromEntries(new FormData(f)), btn = f.querySelector('button:not([type=button])');
    try { if (btn) btn.disabled = true;
      if (f.id === 'loginf') { S.email = d.email; await api('/api/owner/login', { method: 'POST', body: { email: d.email, password: d.password } }); S.err = ''; S.me = await api('/api/admin/me'); start(); return; }
      if (f.id === 'cancelf') { const r = await api(`/api/admin/orders/${encodeURIComponent(S.open)}/cancel`, { method: 'POST', body: { reason: d.reason } }); upd(r.order); toast('Order canceled'); }
      if (f.id === 'refundf') { const full = d.kind === 'full'; if (!full && !(+d.amount > 0)) throw new Error('Enter an amount.'); const r = await api(`/api/admin/orders/${encodeURIComponent(S.open)}/refund`, { method: 'POST', body: { full, amount: +d.amount, reason: d.reason } }); upd(r.order); toast('Refunded ' + m(r.order.refunds[r.order.refunds.length - 1].amount)); }
      if (f.id === 'rangef') { let a = d.from || today(), b = d.to || a; if (a > b) [a, b] = [b, a]; S.from = a; S.to = b; S.rep = null; S.an = null; render(); await loadTab(); }
      if (f.id === 'setf') { const body = { hours: DAYS.map((x, i) => ({ open: d['o' + i], close: d['c' + i], closed: !!d['x' + i] })), pickupMins: +d.pickupMins, taxRate: +d.taxRate, doordashUrl: d.doordashUrl, acceptOrders: !!d.acceptOrders };
        const r = await api('/api/admin/settings', { method: 'PUT', body }); S.settings = r.settings; toast('Saved. Customers see it now.'); render(); }
    } catch (er) { if (f.id === 'loginf') { S.err = er.status === 429 ? er.message : (er.message || 'Wrong email or password.'); render(); const pw = $('[data-testid=login-pass]'); if (pw) pw.focus(); } else toast(er.message); }
    finally { if (btn && document.contains(btn)) btn.disabled = false; } });
  document.addEventListener('input', e => { if (e.target.name === 'amount') { const p = $('[data-testid=refund-part]'); if (p) p.checked = true; } });
  window.addEventListener('hashchange', () => { fromHash(); if (S.me) { render(); loadTab(); } });

  fromHash();
  api('/api/admin/me').then(me => { S.me = me; start(); }).catch(() => { S.me = null; render(); });
})();
