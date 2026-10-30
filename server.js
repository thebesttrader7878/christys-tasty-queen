// Kimmie’s-Christy's Tasty Queen demo: serves the static site and emails orders.
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const TO = process.env.ORDER_EMAIL_TO || 'keys4cash.io@gmail.com';
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

function buildEmail(o) {
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
  return { to: TO, from: SMTP_USER || 'orders@christys-demo.local', subject: `Kimmie’s-Christy's Tasty Queen: new ${o.mode || 'pickup'} order #${clean(o.id)} - ${money(o.total)} (test)`, text };
}

app.post('/api/orders', async (req, res) => {
  const o = req.body || {};
  if (!o.id || !Array.isArray(o.items) || !o.items.length) return res.status(400).json({ ok: false, error: 'Order needs an id and at least one item' });
  const mail = buildEmail(o);
  if (!transport) {
    console.log('[order email, SMTP not set, logged only]\n' + mail.subject + '\n' + mail.text);
    return res.json({ ok: true, emailed: false, logged: true });
  }
  try {
    await transport.sendMail(mail);
    res.json({ ok: true, emailed: true });
  } catch (err) {
    console.error('Order email failed:', err.message);
    res.json({ ok: true, emailed: false, error: 'email failed, order still saved' });
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true, smtp: smtpReady }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) app.listen(PORT, () => console.log(`Kimmie’s-Christy's Tasty Queen demo on :${PORT} (smtp ${smtpReady ? 'on' : 'off, logging emails'})`));
module.exports = { app, buildEmail };
