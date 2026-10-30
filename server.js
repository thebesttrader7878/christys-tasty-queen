// Kimmie’s-Christy's Tasty Queen demo: serves the static site and emails orders.
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_TO = 'keys4cash.io@gmail.com';
const ENV_TO = (process.env.ORDER_EMAIL_TO || '').trim();
const SITE_URL = process.env.SITE_URL || 'https://christys-tasty-queen.onrender.com';
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
// SMTP fallback recipient: ORDER_EMAIL_TO, else the default. Never from the browser.
const pickTo = () => (EMAIL_RE.test(ENV_TO) ? ENV_TO : DEFAULT_TO);
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
const smtpReady = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
const transport = smtpReady ? nodemailer.createTransport({
  host: SMTP_HOST, port: +(SMTP_PORT || 587), secure: +(SMTP_PORT || 587) === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS }
}) : null;

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const money = n => '$' + Number(n || 0).toFixed(2);
const clean = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').slice(0, 300);

function buildEmail(o, to = pickTo()) {
  const lines = (o.items || []).map(i => `${i.qty} x ${clean(i.name)}${i.mods && i.mods.length ? ' (' + i.mods.map(clean).join(', ') + ')' : ''}${i.note ? ' Note: ' + clean(i.note) : ''}  ${money(i.lineTotal)}`);
  const c = o.customer || {};
  const text = [
    "Kimmie’s-Christy's Tasty Queen",
    `NEW ORDER #${clean(o.id)} (TEST)`,
    `${o.mode === 'delivery' ? 'DELIVERY' : 'PICKUP'} ${o.when === 'asap' || !o.when ? 'ASAP' : 'at ' + clean(o.when)}`,
    '', `Customer: ${clean(c.name)}`, `Phone: ${clean(c.phone)}`, `Email: ${clean(c.email)}`,
    o.mode === 'delivery' ? `Address: ${clean(c.address)}` : '',
    '', ...lines, '',
    `Subtotal: ${money(o.subtotal)}`, `Tax: ${money(o.tax)}`,
    o.mode === 'delivery' ? `Delivery fee: ${money(o.deliveryFee)}` : '',
    o.tip ? `Tip: ${money(o.tip)}` : '', `TOTAL: ${money(o.total)}`,
    `Payment: ${clean(o.payment && o.payment.label)} (simulated, no real money)`,
    o.notes ? `Order notes: ${clean(o.notes)}` : ''
  ].filter(x => x !== '').join('\n');
  return { to, from: SMTP_USER || 'orders@christys-demo.local', subject: `Kimmie’s-Christy's Tasty Queen: new ${o.mode || 'pickup'} order #${clean(o.id)} - ${money(o.total)} (test)`, text };
}

// Formspree (or any compatible form webhook) payload.
const DEFAULT_WEBHOOK = 'https://formspree.io/f/xnppbzpy';
const ENV_WEBHOOK = (process.env.ORDER_WEBHOOK_URL || '').trim();
// Server-only: never taken from the browser.
const WEBHOOK_URL = /^https:\/\//.test(ENV_WEBHOOK) ? ENV_WEBHOOK : DEFAULT_WEBHOOK;
function webhookFields(o) {
  const c = o.customer || {};
  const f = {
    _subject: `Kimmie’s-Christy's Tasty Queen: new ${o.mode || 'pickup'} order #${clean(o.id)}`,
    order: '#' + clean(o.id),
    items: (o.items || []).map(i => `${i.qty} x ${clean(i.name)}${i.mods && i.mods.length ? ' (' + i.mods.map(clean).join(', ') + ')' : ''}${i.note ? ' [Note: ' + clean(i.note) + ']' : ''} ${money(i.lineTotal)}`).join(' | '),
    total: `${money(o.total)} (subtotal ${money(o.subtotal)}, tax ${money(o.tax)}${o.tip ? ', tip ' + money(o.tip) : ''})`,
    name: clean(c.name), phone: clean(c.phone),
    pickup_time: o.when === 'asap' || !o.when ? 'ASAP' : clean(o.when),
    payment: `${clean(o.payment && o.payment.label)} (simulated, no real money)`,
    notes: clean(o.notes) || 'None'
  };
  if (EMAIL_RE.test(String(c.email || '').trim())) f.email = String(c.email).trim();
  return f;
}
async function sendWebhook(o, url) {
  if (process.env.WEBHOOK_OFF === '1') return { status: 0, body: { ok: false, message: 'WEBHOOK_OFF (local test)' } };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(webhookFields(o)), signal: AbortSignal.timeout(15000) });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

app.post('/api/orders', async (req, res) => {
  const o = req.body || {};
  if (!o.id || !Array.isArray(o.items) || !o.items.length) return res.status(400).json({ ok: false, error: 'Order needs an id and at least one item' });
  const mail = buildEmail(o), url = WEBHOOK_URL;
  try {
    const w = await sendWebhook(o, url);
    console.log('[webhook]', url, w.status, JSON.stringify(w.body));
    const ok = w.status >= 200 && w.status < 300 && w.body.ok !== false;
    if (ok || !transport) return res.json(Object.assign({ ok: true, emailed: ok, via: 'formspree', status: w.status, formspree: w.body }, ok || !w.status ? {} : { browserSend: { url, fields: webhookFields(o) } }));
  } catch (err) { console.error('Webhook failed:', err.message); }
  if (!transport) {
    console.log('[order email, logged only]\n' + mail.subject + '\n' + mail.text);
    return res.json({ ok: true, emailed: false, logged: true });
  }
  try { await transport.sendMail(mail); res.json({ ok: true, emailed: true, via: 'smtp' }); }
  catch (err) { console.error('SMTP fallback failed:', err.message); res.json({ ok: true, emailed: false, error: 'email failed, order still saved' }); }
});

app.get('/api/config', (req, res) => res.json({ webhook: WEBHOOK_URL }));
app.get('/healthz', (req, res) => res.json({ ok: true, notify: 'formspree', webhook: WEBHOOK_URL, smtpFallback: smtpReady }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) app.listen(PORT, () => console.log(`Kimmie’s-Christy's Tasty Queen demo on :${PORT} (smtp ${smtpReady ? 'on' : 'off, logging emails'})`));
module.exports = { app, buildEmail, webhookFields, pickTo, WEBHOOK_URL };
