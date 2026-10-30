// Storage layer: Postgres when DATABASE_URL is set, otherwise a JSON file.
// Same async interface either way, so the rest of the app never cares which one is live.
const fs = require('fs');
const path = require('path');

function jsonStore(file) {
  let db = { orders: [], kv: {}, events: [] };
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* first run */ }
  let timer = null;
  const flush = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, file); };
  const save = () => { clearTimeout(timer); timer = setTimeout(flush, 50); };
  const inRange = (t, from, to) => (!from || t >= from) && (!to || t < to);
  return {
    kind: 'json', file,
    async init() {},
    async saveOrder(o) { const i = db.orders.findIndex(x => x.id === o.id); if (i >= 0) db.orders[i] = o; else db.orders.push(o); save(); return o; },
    async getOrder(id) { return db.orders.find(x => x.id === id) || null; },
    async listOrders({ from, to, limit } = {}) { const r = db.orders.filter(o => inRange(o.created, from, to)).sort((a, b) => b.created.localeCompare(a.created)); return limit ? r.slice(0, limit) : r; },
    async nextSeq() { db.kv.seq = (db.kv.seq || 1000) + 1; save(); return db.kv.seq; },
    async getKV(k, d) { return k in db.kv ? db.kv[k] : d; },
    async setKV(k, v) { db.kv[k] = v; save(); return v; },
    async addEvent(e) { db.events.push(e); if (db.events.length > 200000) db.events.splice(0, 50000); save(); },
    async listEvents({ from, to } = {}) { return db.events.filter(e => inRange(e.at, from, to)); },
    async close() { clearTimeout(timer); flush(); }
  };
}

function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }, max: 5 });
  const q = (s, p) => pool.query(s, p);
  return {
    kind: 'postgres',
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS ctq_orders (id text PRIMARY KEY, created timestamptz NOT NULL, data jsonb NOT NULL);
        CREATE INDEX IF NOT EXISTS ctq_orders_created ON ctq_orders (created);
        CREATE TABLE IF NOT EXISTS ctq_kv (k text PRIMARY KEY, v jsonb);
        CREATE TABLE IF NOT EXISTS ctq_events (id bigserial PRIMARY KEY, at timestamptz NOT NULL, type text NOT NULL, sid text, path text);
        CREATE INDEX IF NOT EXISTS ctq_events_at ON ctq_events (at);
        CREATE SEQUENCE IF NOT EXISTS ctq_order_seq START 1001;`);
    },
    async saveOrder(o) { await q('INSERT INTO ctq_orders (id, created, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [o.id, o.created, o]); return o; },
    async getOrder(id) { const r = await q('SELECT data FROM ctq_orders WHERE id = $1', [id]); return r.rows[0] ? r.rows[0].data : null; },
    async listOrders({ from, to, limit } = {}) {
      const r = await q(`SELECT data FROM ctq_orders WHERE ($1::timestamptz IS NULL OR created >= $1) AND ($2::timestamptz IS NULL OR created < $2) ORDER BY created DESC ${limit ? 'LIMIT ' + (+limit | 0) : ''}`, [from || null, to || null]);
      return r.rows.map(x => x.data);
    },
    async nextSeq() { const r = await q("SELECT nextval('ctq_order_seq') AS n"); return +r.rows[0].n; },
    async getKV(k, d) { const r = await q('SELECT v FROM ctq_kv WHERE k = $1', [k]); return r.rows[0] ? r.rows[0].v : d; },
    async setKV(k, v) { await q('INSERT INTO ctq_kv (k, v) VALUES ($1,$2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v', [k, JSON.stringify(v)]); return v; },
    async addEvent(e) { await q('INSERT INTO ctq_events (at, type, sid, path) VALUES ($1,$2,$3,$4)', [e.at, e.type, e.sid, e.path || null]); },
    async listEvents({ from, to } = {}) {
      const r = await q('SELECT at, type, sid, path FROM ctq_events WHERE ($1::timestamptz IS NULL OR at >= $1) AND ($2::timestamptz IS NULL OR at < $2)', [from || null, to || null]);
      return r.rows.map(x => ({ at: new Date(x.at).toISOString(), type: x.type, sid: x.sid, path: x.path }));
    },
    async close() { await pool.end(); }
  };
}

module.exports = function makeStore(env = process.env) {
  return env.DATABASE_URL ? pgStore(env.DATABASE_URL) : jsonStore(env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json'));
};
