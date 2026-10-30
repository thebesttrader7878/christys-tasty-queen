// Kimmie’s-Christy's Tasty Queen: storefront, server-side orders, owner dashboard API.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const makeStore = require('./lib/store');
const POS = require('./lib/pos');
const PAY = require('./public/pay.js');

const env = process.env;
const PORT = env.PORT || 3000;
const TZ = 'America/Chicago';
const NAME = "Kimmie’s-Christy's Tasty Queen";
const SITE_URL = env.SITE_URL || 'https://kimmies-christys-tasty-queen.onrender.com';
const DEFAULT_TO = 'keys4cash.io@gmail.com';
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const ENV_TO = (env.ORDER_EMAIL_TO || '').trim();
const pickTo = () => (EMAIL_RE.test(ENV_TO) ? ENV_TO : DEFAULT_TO);
const DEFAULT_WEBHOOK = 'https://formspree.io/f/xnppbzpy';
const WEBHOOK_URL = /^https:\/\//.test((env.ORDER_WEBHOOK_URL || '').trim()) ? env.ORDER_WEBHOOK_URL.trim() : DEFAULT_WEBHOOK;
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = env;
const smtpReady = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
const transport = smtpReady ? nodemailer.createTransport({ host: SMTP_HOST, port: +(SMTP_PORT || 587), secure: +(SMTP_PORT || 587) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } }) : null;

// ---------- Stripe Connect (Standard, OAuth) ----------
const STRIPE_LIVE = !!(env.STRIPE_CLIENT_ID && env.STRIPE_SECRET_KEY);
const stripeApi = async (method, p, params, account) => {
  const r = await fetch('https://api.stripe.com' + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, account ? { 'Stripe-Account': account } : {}), body: params ? new URLSearchParams(params).toString() : undefined, signal: AbortSignal.timeout(15000) });
  const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || 'Stripe error ' + r.status); return j;
};

// ---------- owner auth ----------
const OWNER_EMAIL = (env.OWNER_EMAIL || '').trim().toLowerCase();
const OWNER_HASH = env.OWNER_PASSWORD ? bcrypt.hashSync(env.OWNER_PASSWORD, 12) : null;
const sessions = new Map(); // token -> { email, exp, oauthState }
const SESSION_MS = 12 * 3600 * 1000;
const fails = new Map(); // ip -> [timestamps]
const LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

const store = makeStore(env);
const menu = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'menu.json'), 'utf8'));
const DAYS = 7;
const DEF_SETTINGS = { taxRate: 9.125, pickupMins: 15, acceptOrders: true, pos: 'none', doordashUrl: 'https://www.doordash.com/store/christys-tasty-queen-kansas-city-35171507/', hours: Array.from({ length: DAYS }, () => ({ open: '10:00', close: '18:00', closed: false })) };
const getSettings = async () => Object.assign({}, DEF_SETTINGS, await store.getKV('settings', {}));
const getEdits = async () => store.getKV('menuEdits', {});
const getStripe = async () => store.getKV('stripe', { status: 'none' });

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'same-origin'); next(); });

const r2 = n => Math.round(n * 100) / 100;
const money = n => '$' + Number(n || 0).toFixed(2);
const clean = (s, n = 300) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
const localParts = iso => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, time: `${p.hour}:${p.minute}` }; };
const todayLocal = () => localParts(new Date().toISOString()).date;
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const ipOf = req => req.ip || 'x';

// ---------- pricing (server is the source of truth, never trust browser prices) ----------
function priceCart(lines, edits) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 60) throw new Error('Your cart is empty.');
  return lines.map(l => {
    const base = menu.items[l.id]; if (!base) throw new Error('Unknown item');
    const it = Object.assign({}, base, edits[l.id] || {});
    if (it.hidden || it.soldOut) throw new Error(it.name + ' is not available right now.');
    const qty = Math.min(50, Math.max(1, Math.floor(+l.qty || 1)));
    const picked = Array.isArray(l.mods) ? l.mods.map(x => String(x)) : [];
    let unit = +it.price, mods = [];
    for (const g of it.modifiers || []) {
      const hits = g.options.filter(o => picked.includes(o.name));
      if (g.required && !hits.length) throw new Error('Pick a ' + g.name.toLowerCase() + ' for ' + it.name + '.');
      (g.type === 'single' ? hits.slice(0, 1) : hits).forEach(o => { unit += +o.price || 0; mods.push(o.name); });
    }
    unit = r2(unit);
    return { id: l.id, name: it.name, qty, unit, mods, note: clean(l.note, 200), lineTotal: r2(unit * qty) };
  });
}
const totalsFor = (items, taxRate, tipIn) => { const subtotal = r2(items.reduce((a, l) => a + l.lineTotal, 0)); const tax = r2(subtotal * taxRate / 100); const tip = Math.min(r2(Math.max(0, +tipIn || 0)), subtotal); return { subtotal, tax, tip, deliveryFee: 0, total: r2(subtotal + tax + tip) }; };

// ---------- notifications ----------
function buildEmail(o, to = pickTo()) {
  const lines = (o.items || []).map(i => `${i.qty} x ${clean(i.name)}${i.mods && i.mods.length ? ' (' + i.mods.map(x => clean(x)).join(', ') + ')' : ''}${i.note ? ' Note: ' + clean(i.note) : ''}  ${money(i.lineTotal)}`);
  const c = o.customer || {};
  const text = [NAME, `NEW ORDER #${clean(o.id)}`, `PICKUP ${o.when === 'asap' || !o.when ? 'ASAP' : 'at ' + clean(o.when)}`, '', `Customer: ${clean(c.name)}`, `Phone: ${clean(c.phone)}`, `Email: ${clean(c.email)}`, '', ...lines, '', `Subtotal: ${money(o.subtotal)}`, `Tax: ${money(o.tax)}`, o.tip ? `Tip: ${money(o.tip)}` : '', `TOTAL: ${money(o.total)}`, `Payment: ${clean(o.payment && o.payment.label)}`, o.notes ? `Order notes: ${clean(o.notes)}` : ''].filter(x => x !== '').join('\n');
  return { to, from: SMTP_USER || 'orders@christys-demo.local', subject: `${NAME}: new ${o.mode || 'pickup'} order #${clean(o.id)} - ${money(o.total)}`, text };
}
function webhookFields(o) {
  const c = o.customer || {};
  const f = { _subject: `${NAME}: new ${o.mode || 'pickup'} order #${clean(o.id)}`, order: '#' + clean(o.id),
    items: (o.items || []).map(i => `${i.qty} x ${clean(i.name)}${i.mods && i.mods.length ? ' (' + i.mods.map(x => clean(x)).join(', ') + ')' : ''}${i.note ? ' [Note: ' + clean(i.note) + ']' : ''} ${money(i.lineTotal)}`).join(' | '),
    total: `${money(o.total)} (subtotal ${money(o.subtotal)}, tax ${money(o.tax)}${o.tip ? ', tip ' + money(o.tip) : ''})`,
    name: clean(c.name), phone: clean(c.phone), pickup_time: o.when === 'asap' || !o.when ? 'ASAP' : clean(o.when),
    payment: clean(o.payment && o.payment.label), notes: clean(o.notes) || 'None', dashboard: SITE_URL + '/owner' };
  if (EMAIL_RE.test(String(c.email || '').trim())) f.email = String(c.email).trim();
  return f;
}
async function sendWebhook(o) {
  if (env.WEBHOOK_OFF === '1') return { status: 0, body: { ok: false, message: 'WEBHOOK_OFF (local test)' } };
  const r = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(webhookFields(o)), signal: AbortSignal.timeout(15000) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function notify(o) {
  try {
    const w = await sendWebhook(o);
    console.log('[webhook]', WEBHOOK_URL, w.status, JSON.stringify(w.body));
    const ok = w.status >= 200 && w.status < 300 && w.body.ok !== false;
    if (ok || !transport) return Object.assign({ ok: true, emailed: ok, via: 'formspree', status: w.status, formspree: w.body }, ok || !w.status ? {} : { browserSend: { url: WEBHOOK_URL, fields: webhookFields(o) } });
  } catch (err) { console.error('Webhook failed:', err.message); }
  if (!transport) { const mail = buildEmail(o); console.log('[order email, logged only]\n' + mail.subject + '\n' + mail.text); return { ok: true, emailed: false, logged: true }; }
  try { await transport.sendMail(buildEmail(o)); return { ok: true, emailed: true, via: 'smtp' }; } catch (err) { console.error('SMTP fallback failed:', err.message); return { ok: true, emailed: false }; }
}

// ---------- public API ----------
const publicOrder = o => ({ id: o.id, created: o.created, status: o.status, when: o.when, customer: { name: o.customer.name }, items: o.items, subtotal: o.subtotal, tax: o.tax, tip: o.tip, total: o.total, refunded: o.refunded || 0, cancelReason: o.cancelReason || '', payment: { label: o.payment.label, method: o.payment.method }, updated: o.updated });

app.get('/api/site', async (req, res) => { const s = await getSettings(), st = await getStripe();
  res.set('Cache-Control', 'no-store');
  res.json({ settings: { taxRate: s.taxRate, pickupMins: s.pickupMins, acceptOrders: s.acceptOrders, doordashUrl: s.doordashUrl, hours: s.hours }, menuEdits: await getEdits(),
    stripe: { mode: STRIPE_LIVE ? 'live' : 'demo', connected: st.status === 'connected', publishableKey: STRIPE_LIVE ? (env.STRIPE_PUBLISHABLE_KEY || '') : '', account: STRIPE_LIVE && st.status === 'connected' ? st.id : '' } }); });

// Live mode only: create a PaymentIntent on the owner's connected account (direct charge).
app.post('/api/checkout/intent', async (req, res) => {
  try { const st = await getStripe(); if (!STRIPE_LIVE || st.status !== 'connected') return res.status(400).json({ ok: false, error: 'Card payments are in demo mode.' });
    const s = await getSettings(), items = priceCart(req.body.items, await getEdits()), t = totalsFor(items, s.taxRate, req.body.tip);
    const pi = await stripeApi('POST', '/v1/payment_intents', { amount: Math.round(t.total * 100), currency: 'usd', 'automatic_payment_methods[enabled]': 'true', description: NAME + ' online pickup order' }, st.id);
    res.json({ ok: true, clientSecret: pi.client_secret, id: pi.id, total: t.total });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

const TRACK_TYPES = new Set(['pageview', 'menuview', 'addtocart', 'checkout']);
const trackHits = new Map();
app.post('/api/track', async (req, res) => {
  const { type, sid } = req.body || {}; const ip = ipOf(req), now = Date.now();
  const h = (trackHits.get(ip) || []).filter(t => now - t < 60000); h.push(now); trackHits.set(ip, h);
  if (h.length > 120 || !TRACK_TYPES.has(type) || !/^[a-z0-9]{8,40}$/i.test(String(sid || ''))) return res.status(204).end();
  await store.addEvent({ at: new Date().toISOString(), type, sid: String(sid), path: clean(req.body.path, 80) }).catch(() => {});
  res.status(204).end();
});

const orderHits = new Map();
app.post('/api/orders', async (req, res) => {
  const b = req.body || {}; const ip = ipOf(req), now = Date.now();
  const h = (orderHits.get(ip) || []).filter(t => now - t < 600000); if (h.length >= 20) return res.status(429).json({ ok: false, error: 'Too many orders from here, call us instead.' }); h.push(now); orderHits.set(ip, h);
  try {
    const s = await getSettings(); if (!s.acceptOrders) return res.status(409).json({ ok: false, error: 'We are not taking online orders right now.' });
    const c = b.customer || {}; const name = clean(c.name, 80), phone = clean(c.phone, 30);
    if (!name || phone.replace(/\D/g, '').length < 7) return res.status(400).json({ ok: false, error: 'Add your name and phone.' });
    const items = priceCart(b.items, await getEdits()), t = totalsFor(items, s.taxRate, b.tip);
    const st = await getStripe(); const p = b.payment || {};
    let payment;
    if (p.method === 'store') payment = { method: 'store', label: 'Pay at pickup', id: 'pay_instore_' + now, fee: 0, demo: !STRIPE_LIVE };
    else if (STRIPE_LIVE && st.status === 'connected') {
      const pi = await stripeApi('GET', '/v1/payment_intents/' + encodeURIComponent(String(p.id || '')), null, st.id);
      if (pi.status !== 'succeeded' || pi.amount !== Math.round(t.total * 100)) return res.status(402).json({ ok: false, error: 'Payment did not go through.' });
      payment = { method: 'card', label: 'Card (Stripe)', id: pi.id, fee: PAY.cardFee(t.total), live: true, account: st.id };
    } else {
      if (!/^pi_demo_[a-z0-9]{6,20}$/.test(String(p.id || ''))) return res.status(400).json({ ok: false, error: 'Payment missing.' });
      payment = { method: 'card', label: 'Card •••• ' + clean(p.last4, 4).replace(/\D/g, '') + ' (demo)', id: p.id, fee: PAY.cardFee(t.total), demo: true };
    }
    const id = String(await store.nextSeq());
    const created = new Date().toISOString();
    const o = { id, token: crypto.randomBytes(12).toString('hex'), created, updated: created, status: 'new', mode: 'pickup', when: clean(b.when, 40) || 'asap',
      customer: { name, phone, email: EMAIL_RE.test(String(c.email || '').trim()) ? String(c.email).trim().slice(0, 120) : '' }, notes: clean(b.notes, 300),
      items, ...t, payment, refunds: [], refunded: 0, sid: /^[a-z0-9]{8,40}$/i.test(String(b.sid || '')) ? b.sid : '', log: [{ at: created, status: 'new' }] };
    o.pos = POS.push(s.pos, o);
    await store.saveOrder(o);
    const n = await notify(o);
    res.json(Object.assign({ ok: true, id: o.id, token: o.token, order: publicOrder(o) }, { email: n }));
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/api/orders/:id', async (req, res) => { res.set('Cache-Control', 'no-store');
  const o = await store.getOrder(String(req.params.id));
  if (!o || !req.query.t || !crypto.timingSafeEqual(Buffer.from(String(req.query.t).padEnd(24).slice(0, 24)), Buffer.from(o.token))) return res.status(404).json({ ok: false, error: 'Order not found' });
  res.json({ ok: true, order: publicOrder(o) }); });

// ---------- owner auth routes ----------
const setCookie = (req, res, v, maxAge) => res.set('Set-Cookie', `ctq_owner=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`);
const getSession = req => { const t = cookies(req).ctq_owner; const s = t && sessions.get(t); if (!s) return null; if (s.exp < Date.now()) { sessions.delete(t); return null; } return Object.assign(s, { token: t }); };
const needOwner = (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); res.set('Cache-Control', 'no-store'); const s = getSession(req); if (!s) return res.status(401).json({ ok: false, error: 'Log in first' }); req.owner = s; next(); };

app.post('/api/owner/login', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const ip = ipOf(req), now = Date.now(); const f = (fails.get(ip) || []).filter(t => now - t < LIMIT.windowMs); fails.set(ip, f);
  if (f.length >= LIMIT.max) { const wait = Math.ceil((LIMIT.windowMs - (now - f[0])) / 60000); res.set('Retry-After', String(wait * 60)); return res.status(429).json({ ok: false, error: `Too many tries. Wait ${wait} min and try again.` }); }
  if (!OWNER_EMAIL || !OWNER_HASH) return res.status(503).json({ ok: false, error: 'Owner login is not set up yet (OWNER_EMAIL / OWNER_PASSWORD).' });
  const { email, password } = req.body || {};
  const ok = String(email || '').trim().toLowerCase() === OWNER_EMAIL & (await bcrypt.compare(String(password || '').slice(0, 200), OWNER_HASH));
  if (!ok) { f.push(now); return res.status(401).json({ ok: false, error: 'That email or password is wrong.', left: Math.max(0, LIMIT.max - f.length) }); }
  fails.delete(ip);
  const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { email: OWNER_EMAIL, exp: now + SESSION_MS });
  setCookie(req, res, token, SESSION_MS / 1000); res.json({ ok: true, email: OWNER_EMAIL });
});
app.post('/api/owner/logout', (req, res) => { const s = getSession(req); if (s) sessions.delete(s.token); setCookie(req, res, '', 0); res.json({ ok: true }); });

// ---------- owner API ----------
app.use('/api/admin', needOwner);
app.get('/api/admin/me', (req, res) => res.json({ ok: true, email: req.owner.email, store: store.kind, stripeMode: STRIPE_LIVE ? 'live' : 'demo' }));

const view = o => Object.assign({}, o, { token: undefined, local: localParts(o.created) });
app.get('/api/admin/orders', async (req, res) => { const since = new Date(Date.now() - 45 * 864e5).toISOString(); res.json({ ok: true, now: new Date().toISOString(), orders: (await store.listOrders({ from: since, limit: 500 })).map(view) }); });

const FLOW = { new: ['preparing', 'canceled'], preparing: ['ready', 'canceled'], ready: ['completed', 'canceled'], completed: [], canceled: [] };
async function doRefund(o, amount, reason) {
  const left = r2(o.total - (o.refunded || 0));
  if (o.payment.method === 'store' && o.status !== 'completed') throw new Error('Pay-at-pickup orders have not been paid yet. Cancel instead.');
  let rf;
  if (o.payment.live) { const re = await stripeApi('POST', '/v1/refunds', { payment_intent: o.payment.id, amount: String(Math.round(amount * 100)) }, o.payment.account); rf = { ok: true, id: re.id, amount: r2(re.amount / 100) }; }
  else rf = PAY.refund({ paymentId: o.payment.id, amount, already: o.refunded || 0, total: o.total });
  if (!rf.ok) throw new Error(rf.error);
  if (rf.amount > left + 0.001) throw new Error('That is more than what is left to refund.');
  const at = new Date().toISOString();
  o.refunds = (o.refunds || []).concat({ at, amount: rf.amount, id: rf.id, reason: clean(reason, 200), demo: !o.payment.live, method: o.payment.method === 'store' ? 'cash' : 'card' });
  o.refunded = r2((o.refunded || 0) + rf.amount); o.updated = at; o.log.push({ at, status: 'refund', amount: rf.amount });
}
app.post('/api/admin/orders/:id/:action', async (req, res) => {
  try {
    const o = await store.getOrder(String(req.params.id)); if (!o) return res.status(404).json({ ok: false, error: 'Order not found' });
    const a = req.params.action, at = new Date().toISOString();
    if (a === 'status') { const to = String(req.body.status); if (!FLOW[o.status] || !FLOW[o.status].includes(to) || to === 'canceled') throw new Error(`Can't move a ${o.status} order to ${to}.`); o.status = to; o.updated = at; o.log.push({ at, status: to }); }
    else if (a === 'cancel') { const reason = clean(req.body.reason, 200); if (!reason) throw new Error('Add a reason so the customer knows why.'); if (!FLOW[o.status].includes('canceled')) throw new Error(`Can't cancel a ${o.status} order.`);
      if (o.payment.method === 'card') { const left = r2(o.total - (o.refunded || 0)); if (left > 0) await doRefund(o, left, 'Canceled: ' + reason); }
      o.status = 'canceled'; o.cancelReason = reason; o.updated = at; o.log.push({ at, status: 'canceled', note: reason }); }
    else if (a === 'refund') { const left = r2(o.total - (o.refunded || 0)); const amt = req.body.full ? left : r2(+req.body.amount); if (!(amt > 0)) throw new Error('Enter an amount.'); await doRefund(o, amt, req.body.reason); }
    else return res.status(404).json({ ok: false, error: 'Unknown action' });
    await store.saveOrder(o); res.json({ ok: true, order: view(o) });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ---------- analytics & reports ----------
const net = o => o.status === 'canceled' ? 0 : r2(o.total - (o.refunded || 0));
function summarize(orders) {
  const live = orders.filter(o => o.status !== 'canceled');
  const sum = f => r2(live.reduce((a, o) => a + (+f(o) || 0), 0));
  const items = {};
  live.forEach(o => o.items.forEach(l => { const k = l.name; items[k] = items[k] || { item: k, qty: 0, sales: 0, orders: 0 }; items[k].qty += l.qty; items[k].sales = r2(items[k].sales + l.lineTotal); items[k].orders++; }));
  const byPay = {}; live.forEach(o => { const k = o.payment.method === 'store' ? 'Pay at pickup' : 'Card'; byPay[k] = byPay[k] || { orders: 0, total: 0 }; byPay[k].orders++; byPay[k].total = r2(byPay[k].total + o.total); });
  const revenue = r2(live.reduce((a, o) => a + net(o), 0));
  return { orders: orders.length, paidOrders: live.length, canceled: orders.length - live.length, completed: orders.filter(o => o.status === 'completed').length,
    gross: sum(o => o.total), subtotal: sum(o => o.subtotal), tax: sum(o => o.tax), tips: sum(o => o.tip),
    refunds: r2(orders.reduce((a, o) => a + (o.refunded || 0), 0)), refundCount: orders.filter(o => (o.refunded || 0) > 0).length,
    revenue, avgOrder: live.length ? r2(revenue / live.length) : 0, cardFees: r2(live.reduce((a, o) => a + (o.payment.fee || 0), 0)),
    byPayment: byPay, items: Object.values(items).sort((a, b) => b.sales - a.sales) };
}
async function ordersBetween(fromDate, toDate) { // local dates, inclusive
  const from = new Date(new Date(fromDate + 'T00:00:00Z').getTime() - 864e5).toISOString(), to = new Date(new Date(toDate + 'T00:00:00Z').getTime() + 2 * 864e5).toISOString();
  return (await store.listOrders({ from, to })).filter(o => { const d = localParts(o.created).date; return d >= fromDate && d <= toDate; });
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const rangeQ = q => { let to = DATE_RE.test(q.to || '') ? q.to : todayLocal(); let from = DATE_RE.test(q.from || '') ? q.from : addDays(to, -6); if (from > to) [from, to] = [to, from]; if (from < addDays(to, -365)) from = addDays(to, -365); return [from, to]; };
app.get('/api/admin/analytics', async (req, res) => {
  let from, to, range = 'custom';
  if (req.query.from || req.query.to) [from, to] = rangeQ(req.query);
  else { range = ['today', '7d', '30d'].includes(req.query.range) ? req.query.range : 'today'; to = todayLocal(); from = range === 'today' ? to : addDays(to, range === '7d' ? -6 : -29); }
  const orders = await ordersBetween(from, to), s = summarize(orders);
  const byHour = Array(24).fill(0); orders.forEach(o => byHour[localParts(o.created).hour]++);
  const evFrom = new Date(new Date(from + 'T00:00:00Z').getTime() - 864e5).toISOString();
  const evs = (await store.listEvents({ from: evFrom })).filter(e => { const d = localParts(e.at).date; return d >= from && d <= to; });
  const uniq = t => new Set(evs.filter(e => e.type === t).map(e => e.sid)).size;
  const views = evs.filter(e => e.type === 'pageview').length, visitors = uniq('pageview');
  const funnel = [['Visitors', visitors], ['Viewed menu', uniq('menuview')], ['Added to cart', uniq('addtocart')], ['Started checkout', uniq('checkout')], ['Ordered', orders.length]];
  res.json({ ok: true, range, from, to, pageViews: views, visitors, funnel, conversion: visitors ? r2(orders.length / visitors * 100) : 0, byHour,
    revenue: s.revenue, orders: s.orders, avgOrder: s.avgOrder, refunds: s.refunds, refundCount: s.refundCount, canceled: s.canceled, topItems: s.items.slice(0, 8) });
});
app.get('/api/admin/report', async (req, res) => { const [from, to] = rangeQ(req.query); const orders = await ordersBetween(from, to); res.json({ ok: true, from, to, summary: summarize(orders) }); });
const csvCell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
app.get('/api/admin/export/:kind.csv', async (req, res) => {
  const [from, to] = rangeQ(req.query); const orders = (await ordersBetween(from, to)).sort((a, b) => a.created.localeCompare(b.created));
  let rows;
  if (req.params.kind === 'orders') rows = [['order', 'date', 'time', 'status', 'customer', 'phone', 'email', 'items', 'subtotal', 'tax', 'tip', 'total', 'refunded', 'net', 'payment', 'cancel_reason', 'notes']].concat(orders.map(o => { const l = localParts(o.created);
    return [o.id, l.date, l.time, o.status, o.customer.name, o.customer.phone, o.customer.email, o.items.map(i => `${i.qty}x ${i.name}${i.mods.length ? ' (' + i.mods.join(', ') + ')' : ''}`).join('; '), o.subtotal.toFixed(2), o.tax.toFixed(2), o.tip.toFixed(2), o.total.toFixed(2), (o.refunded || 0).toFixed(2), net(o).toFixed(2), o.payment.label, o.cancelReason || '', o.notes]; }));
  else if (req.params.kind === 'items') rows = [['item', 'qty_sold', 'orders', 'sales']].concat(summarize(orders).items.map(i => [i.item, i.qty, i.orders, i.sales.toFixed(2)]));
  else return res.status(404).end();
  res.set('Content-Type', 'text/csv; charset=utf-8'); res.set('Content-Disposition', `attachment; filename="christys-${req.params.kind}-${from}-to-${to}.csv"`);
  res.send('\ufeff' + csv(rows));
});

// ---------- menu, hours, settings ----------
app.get('/api/admin/settings', async (req, res) => res.json({ ok: true, settings: await getSettings(), menuEdits: await getEdits(), webhook: WEBHOOK_URL, pos: POS.labels }));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
app.put('/api/admin/settings', async (req, res) => {
  const cur = await getSettings(), b = req.body || {}, n = Object.assign({}, cur);
  if (Array.isArray(b.hours) && b.hours.length === 7) { if (!b.hours.every(h => TIME_RE.test(h.open) && TIME_RE.test(h.close))) return res.status(400).json({ ok: false, error: 'Hours need a valid time.' }); n.hours = b.hours.map(h => ({ open: h.open, close: h.close, closed: !!h.closed })); }
  if (b.pickupMins != null) n.pickupMins = Math.min(180, Math.max(1, Math.round(+b.pickupMins || 15)));
  if (b.taxRate != null) { const t = +b.taxRate; if (!(t >= 0 && t < 20)) return res.status(400).json({ ok: false, error: 'Tax rate looks off.' }); n.taxRate = t; }
  if (b.doordashUrl != null) { if (b.doordashUrl && !/^https:\/\/(www\.)?doordash\.com\//.test(b.doordashUrl)) return res.status(400).json({ ok: false, error: 'DoorDash link must start with https://www.doordash.com/' }); n.doordashUrl = String(b.doordashUrl).slice(0, 300); }
  if (b.acceptOrders != null) n.acceptOrders = !!b.acceptOrders;
  if (b.pos != null && POS.ADAPTERS[b.pos]) n.pos = b.pos;
  await store.setKV('settings', n); res.json({ ok: true, settings: n });
});
app.put('/api/admin/menu/:id', async (req, res) => {
  const id = String(req.params.id); if (!menu.items[id]) return res.status(404).json({ ok: false, error: 'No such item' });
  const ed = await getEdits(), b = req.body || {}, e = Object.assign({}, ed[id]);
  if (b.price != null) { const p = r2(+b.price); if (!(p >= 0 && p < 500)) return res.status(400).json({ ok: false, error: 'Price looks off.' }); e.price = p; }
  if (b.soldOut != null) e.soldOut = !!b.soldOut; if (b.hidden != null) e.hidden = !!b.hidden;
  ed[id] = e; await store.setKV('menuEdits', ed); res.json({ ok: true, edit: e });
});
app.delete('/api/admin/menu', async (req, res) => { await store.setKV('menuEdits', {}); res.json({ ok: true }); });

// ---------- Stripe Connect routes ----------
app.get('/api/admin/stripe', async (req, res) => { const st = await getStripe(); res.json({ ok: true, mode: STRIPE_LIVE ? 'live' : 'demo', status: st.status, account: st.id || '', connectedAt: st.at || '' }); });
app.get('/api/admin/stripe/connect', async (req, res) => {
  if (!STRIPE_LIVE) { await store.setKV('stripe', { status: 'connected', id: 'acct_demo_' + crypto.randomBytes(5).toString('hex'), demo: true, at: new Date().toISOString() }); return res.redirect('/owner#pay?stripe=connected'); }
  const state = crypto.randomBytes(16).toString('hex'); req.owner.oauthState = state;
  const u = new URL('https://connect.stripe.com/oauth/authorize');
  u.search = new URLSearchParams({ response_type: 'code', client_id: env.STRIPE_CLIENT_ID, scope: 'read_write', state, redirect_uri: SITE_URL + '/api/admin/stripe/callback', 'stripe_user[business_name]': NAME }).toString();
  res.redirect(u.toString());
});
app.get('/api/admin/stripe/callback', async (req, res) => {
  if (!STRIPE_LIVE) return res.redirect('/owner#pay');
  if (req.query.error) return res.redirect('/owner#pay?stripe=' + encodeURIComponent(String(req.query.error)));
  if (!req.owner.oauthState || req.query.state !== req.owner.oauthState) return res.status(400).send('Stripe connect expired, go back and try again.');
  req.owner.oauthState = null;
  try { const r = await fetch('https://connect.stripe.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_secret: env.STRIPE_SECRET_KEY, code: String(req.query.code || ''), grant_type: 'authorization_code' }) });
    const j = await r.json(); if (!r.ok || !j.stripe_user_id) throw new Error(j.error_description || 'Stripe connect failed');
    await store.setKV('stripe', { status: 'connected', id: j.stripe_user_id, demo: false, at: new Date().toISOString() }); res.redirect('/owner#pay?stripe=connected');
  } catch (e) { res.redirect('/owner#pay?stripe=failed'); }
});
app.post('/api/admin/stripe/disconnect', async (req, res) => {
  const st = await getStripe();
  if (STRIPE_LIVE && st.status === 'connected' && !st.demo) { try { await fetch('https://connect.stripe.com/oauth/deauthorize', { method: 'POST', headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.STRIPE_CLIENT_ID, stripe_user_id: st.id }) }); } catch (e) { /* still forget it locally */ } }
  await store.setKV('stripe', { status: 'none' }); res.json({ ok: true });
});

// ---------- pages ----------
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /owner\nDisallow: /api/\n'));
const ownerDir = path.join(__dirname, 'owner');
app.use('/owner', (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); res.set('Cache-Control', 'no-store'); next(); });
app.get(['/owner', '/owner/'], (req, res) => res.sendFile(path.join(ownerDir, 'index.html')));
app.use('/owner', express.static(ownerDir));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/healthz', (req, res) => res.json({ ok: true, notify: 'formspree', webhook: WEBHOOK_URL, smtpFallback: smtpReady, store: store.kind, ownerLogin: !!(OWNER_EMAIL && OWNER_HASH), stripe: STRIPE_LIVE ? 'live' : 'demo' }));
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const ready = store.init();
if (require.main === module) ready.then(() => app.listen(PORT, () => console.log(`${NAME} on :${PORT} (store ${store.kind}, smtp ${smtpReady ? 'on' : 'off'}, stripe ${STRIPE_LIVE ? 'live' : 'demo'}, owner login ${OWNER_HASH ? 'on' : 'OFF'})`))).catch(e => { console.error('Store init failed:', e); process.exit(1); });
module.exports = { app, ready, store, buildEmail, webhookFields, priceCart, summarize, localParts };
