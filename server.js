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
// Browser-picked address (owner dashboard) wins, then ORDER_EMAIL_TO, then the default.
const pickTo = o => { const b = String((o && o.notifyEmail) || '').trim(); return EMAIL_RE.test(b) && b.length < 120 ? b : (EMAIL_RE.test(ENV_TO) ? ENV_TO : DEFAULT_TO); };
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

function buildEmail(o, to = pickTo(o)) {
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

// FormSubmit payload: one row per field, rendered as a table in the email.
function formSubmitFields(o) {
  const c = o.customer || {};
  return {
    _subject: `Kimmie’s-Christy's Tasty Queen: new ${o.mode || 'pickup'} order #${clean(o.id)}`,
    _template: 'table', _captcha: 'false',
    Order: '#' + clean(o.id),
    Items: (o.items || []).map(i => `${i.qty} x ${clean(i.name)}${i.mods && i.mods.length ? ' (' + i.mods.map(clean).join(', ') + ')' : ''}${i.note ? ' [Note: ' + clean(i.note) + ']' : ''} ${money(i.lineTotal)}`).join(' | '),
    Total: `${money(o.total)} (subtotal ${money(o.subtotal)}, tax ${money(o.tax)}${o.tip ? ', tip ' + money(o.tip) : ''})`,
    Name: clean(c.name), Phone: clean(c.phone), Email: clean(c.email),
    'Pickup time': o.when === 'asap' || !o.when ? 'ASAP' : clean(o.when),
    Payment: `${clean(o.payment && o.payment.label)} (simulated, no real money)`,
    Notes: clean(o.notes) || 'None'
  };
}

async function sendFormSubmit(o, to) {
  if (process.env.FORMSUBMIT_OFF === '1') return { status: 0, body: { success: 'false', message: 'FORMSUBMIT_OFF (local test)' } };
  const r = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(to), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SITE_URL, Referer: SITE_URL + '/' },
    body: JSON.stringify(formSubmitFields(o)), signal: AbortSignal.timeout(15000)
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

app.post('/api/orders', async (req, res) => {
  const o = req.body || {};
  if (!o.id || !Array.isArray(o.items) || !o.items.length) return res.status(400).json({ ok: false, error: 'Order needs an id and at least one item' });
  const to = pickTo(o), mail = buildEmail(o, to);
  try {
    const fs = await sendFormSubmit(o, to);
    console.log('[formsubmit]', to, fs.status, JSON.stringify(fs.body));
    const ok = fs.status < 300 && String(fs.body.success) === 'true';
    if (ok || !transport) return res.json({ ok: true, emailed: ok, via: 'formsubmit', formsubmit: fs.body });
  } catch (err) { console.error('FormSubmit failed:', err.message); }
  if (!transport) {
    console.log('[order email, logged only]\n' + mail.subject + '\n' + mail.text);
    return res.json({ ok: true, emailed: false, logged: true });
  }
  try { await transport.sendMail(mail); res.json({ ok: true, emailed: true, via: 'smtp' }); }
  catch (err) { console.error('SMTP fallback failed:', err.message); res.json({ ok: true, emailed: false, error: 'email failed, order still saved' }); }
});

app.get('/healthz', (req, res) => res.json({ ok: true, notify: 'formsubmit', smtpFallback: smtpReady }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) app.listen(PORT, () => console.log(`Kimmie’s-Christy's Tasty Queen demo on :${PORT} (smtp ${smtpReady ? 'on' : 'off, logging emails'})`));
module.exports = { app, buildEmail, formSubmitFields, pickTo };
