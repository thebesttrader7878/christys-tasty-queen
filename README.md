# Kimmie’s-Christy's Tasty Queen, online ordering demo

Small Express app: serves `public/` and `POST /api/orders` (emails each order).

Run locally: `npm install && npm start` then open http://localhost:3000
Owner dashboard: `#/admin`, demo PIN 1234.
Test card: 4242 4242 4242 4242 (4000 0000 0000 0002 = decline). All payments simulated.

## Env vars (Render)
- ORDER_EMAIL_TO = keys4cash.io@gmail.com
- SMTP_HOST = smtp.gmail.com
- SMTP_PORT = 465
- SMTP_USER = the Gmail address that sends
- SMTP_PASS = a Gmail App Password (16 chars, needs 2-Step Verification on)
If SMTP vars are missing, orders still work and the email is printed to the logs.

## Files
- public/menu.json  menu pulled from DoorDash (prices as listed there)
- public/app.js     storefront, cart, checkout, confirmation, owner dashboard (localStorage)
- public/pay.js     simulated Stripe Connect (no keys, no money)
- public/pos.js     POS layer: Square / Clover / Toast adapters, stubbed
- test_e2e.py       headless browser test (server on :3999)

Note: orders, menu edits and hours are saved in the browser (localStorage), so the dashboard only sees orders placed in the same browser. The email is the real cross-device notice until a database is added.
