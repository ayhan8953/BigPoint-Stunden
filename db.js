// db.js — unterstützt lokale JSON-Dateien und Cloud-PostgreSQL
const path = require('path');
const fs = require('fs');

const USE_PG = !!process.env.DATABASE_URL;

// ── JSON-Hilfsfunktionen ───────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const EMP_FILE   = path.join(DATA_DIR, 'employees.json');
const REC_FILE   = path.join(DATA_DIR, 'records.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');

function rj(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function wj(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function nowCH() { return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Zurich' }).replace(' ', 'T'); }
function todayCH() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' }); }
function nextId(arr) { return arr.length === 0 ? 1 : Math.max(...arr.map(x => x.id)) + 1; }

// ── PostgreSQL ─────────────────────────────────────────────────────────────
let pool;
if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

// ── Stunden berechnen ──────────────────────────────────────────────────────
function calcMs(records) {
  let workMs = 0, breakMs = 0, lastIn = null, lastBreak = null;
  for (const r of records) {
    const t = new Date(r.timestamp).getTime();
    if      (r.type === 'check_in')    { lastIn = t; }
    else if (r.type === 'break_start') { if (lastIn) workMs += t - lastIn; lastBreak = t; lastIn = null; }
    else if (r.type === 'break_end')   { if (lastBreak) breakMs += t - lastBreak; lastIn = t; lastBreak = null; }
    else if (r.type === 'check_out')   { if (lastIn) workMs += t - lastIn; lastIn = null; }
  }
  return { workMs, breakMs };
}
function fmtMs(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}min`;
}
function calcHours(s) {
  const { workMs, breakMs } = calcMs(s.records);
  return { ...s, work_time: fmtMs(workMs), break_time: `${Math.floor(breakMs / 60000)}min` };
}

// ── Datenbank-Abstraktionsschicht ──────────────────────────────────────────
const db = {

  async init() {
    if (USE_PG) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS employees (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          pin TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS records (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          photo_data TEXT
        );
        CREATE TABLE IF NOT EXISTS admin_config (
          id INTEGER PRIMARY KEY DEFAULT 1,
          name TEXT NOT NULL,
          pin TEXT NOT NULL
        );
      `);
      await pool.query(`
        INSERT INTO admin_config (id, name, pin) VALUES (1, 'Eyup', '0000') ON CONFLICT (id) DO NOTHING;
        INSERT INTO admin_config (id, name, pin) VALUES (2, 'Ayhan', '1627') ON CONFLICT (id) DO NOTHING;
        INSERT INTO employees (name, pin) VALUES ('Shafiq','1111'),('Sadat','2222'),('Mohammed','3333') ON CONFLICT (name) DO NOTHING;
      `);
    } else {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(EMP_FILE)) wj(EMP_FILE, [
        { id: 1, name: 'Shafiq',   pin: '1111', created_at: nowCH() },
        { id: 2, name: 'Sadat',    pin: '2222', created_at: nowCH() },
        { id: 3, name: 'Mohammed', pin: '3333', created_at: nowCH() }
      ]);
      if (!fs.existsSync(ADMIN_FILE)) wj(ADMIN_FILE, [
        { id: 1, name: 'Eyup',  pin: '0000' },
        { id: 2, name: 'Ayhan', pin: '1627' }
      ]);
      else {
        const raw = rj(ADMIN_FILE, null);
        if (raw && !Array.isArray(raw)) wj(ADMIN_FILE, [{ id: 1, ...raw }, { id: 2, name: 'Ayhan', pin: '1627' }]);
      }
      if (!fs.existsSync(REC_FILE))   wj(REC_FILE, []);
    }
  },

  async login(pin) {
    if (USE_PG) {
      const a = await pool.query('SELECT * FROM admin_config');
      const admin = a.rows.find(r => r.pin === pin);
      if (admin) return { type: 'admin', name: admin.name, adminId: admin.id };
      const e = await pool.query('SELECT id, name FROM employees WHERE pin=$1', [pin]);
      if (!e.rows[0]) return null;
      const today = todayCH();
      const r = await pool.query(`
        SELECT type, timestamp FROM records WHERE employee_id=$1
        AND (timestamp AT TIME ZONE 'Europe/Zurich')::date = $2::date
        ORDER BY timestamp DESC LIMIT 1`, [e.rows[0].id, today]);
      return { type: 'employee', employee: { ...e.rows[0], status: r.rows[0]?.type || 'absent' } };
    } else {
      const admins = Array.isArray(rj(ADMIN_FILE, [])) ? rj(ADMIN_FILE, []) : [{ id: 1, ...rj(ADMIN_FILE, {}) }];
      const admin = admins.find(a => a.pin === pin);
      if (admin) return { type: 'admin', name: admin.name, adminId: admin.id };
      const emps = rj(EMP_FILE, []);
      const emp = emps.find(e => e.pin === pin);
      if (!emp) return null;
      const today = todayCH();
      const recs = rj(REC_FILE, []).filter(r => r.employee_id === emp.id && r.timestamp.startsWith(today)).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
      const last = recs[recs.length - 1];
      return { type: 'employee', employee: { id: emp.id, name: emp.name, status: last?.type || 'absent' } };
    }
  },

  async getEmployees() {
    if (USE_PG) {
      const r = await pool.query('SELECT id, name, pin FROM employees ORDER BY name');
      return r.rows;
    }
    return rj(EMP_FILE, []).sort((a,b) => a.name.localeCompare(b.name));
  },

  async addEmployee(name, pin) {
    if (USE_PG) {
      const r = await pool.query('INSERT INTO employees (name,pin) VALUES ($1,$2) RETURNING id,name', [name,pin]);
      return r.rows[0];
    }
    const emps = rj(EMP_FILE, []);
    const emp = { id: nextId(emps), name, pin, created_at: nowCH() };
    emps.push(emp); wj(EMP_FILE, emps);
    return { id: emp.id, name: emp.name };
  },

  async deleteEmployee(id) {
    if (USE_PG) { await pool.query('DELETE FROM employees WHERE id=$1', [id]); return; }
    wj(EMP_FILE, rj(EMP_FILE,[]).filter(e=>e.id!==id));
    wj(REC_FILE, rj(REC_FILE,[]).filter(r=>r.employee_id!==id));
  },

  async updateEmployeePin(id, pin) {
    if (USE_PG) { await pool.query('UPDATE employees SET pin=$1 WHERE id=$2', [pin,id]); return; }
    const emps = rj(EMP_FILE, []);
    const i = emps.findIndex(e=>e.id===id);
    if (i>=0) { emps[i].pin = pin; wj(EMP_FILE, emps); }
  },

  async isPinTaken(pin, excludeId = null) {
    if (USE_PG) {
      const a = await pool.query('SELECT pin FROM admin_config');
      if (a.rows.some(r => r.pin === pin)) return true;
      const q = excludeId ? 'SELECT id FROM employees WHERE pin=$1 AND id!=$2' : 'SELECT id FROM employees WHERE pin=$1';
      const r = await pool.query(q, excludeId ? [pin,excludeId] : [pin]);
      return r.rows.length > 0;
    }
    const admins = Array.isArray(rj(ADMIN_FILE, [])) ? rj(ADMIN_FILE, []) : [rj(ADMIN_FILE, {})];
    if (admins.some(a => a.pin === pin)) return true;
    return rj(EMP_FILE,[]).some(e => e.pin===pin && e.id!==excludeId);
  },

  async updateAdminPin(adminId, pin) {
    if (USE_PG) { await pool.query('UPDATE admin_config SET pin=$1 WHERE id=$2', [pin, adminId]); return; }
    const admins = Array.isArray(rj(ADMIN_FILE, [])) ? rj(ADMIN_FILE, []) : [{ id: 1, ...rj(ADMIN_FILE, {}) }];
    const i = admins.findIndex(a => a.id === adminId);
    if (i >= 0) { admins[i].pin = pin; wj(ADMIN_FILE, admins); }
  },

  async getStatus() {
    if (USE_PG) {
      const emps = await pool.query('SELECT id, name FROM employees ORDER BY name');
      const today = todayCH();
      return Promise.all(emps.rows.map(async emp => {
        const r = await pool.query(`
          SELECT type, to_char(timestamp AT TIME ZONE 'Europe/Zurich','YYYY-MM-DD"T"HH24:MI:SS') as timestamp
          FROM records WHERE employee_id=$1
          AND (timestamp AT TIME ZONE 'Europe/Zurich')::date = $2::date
          ORDER BY timestamp DESC LIMIT 1`, [emp.id, today]);
        const last = r.rows[0] || null;
        return { id: emp.id, name: emp.name, status: last?.type || 'absent', lastRecord: last };
      }));
    }
    const emps = rj(EMP_FILE,[]).sort((a,b)=>a.name.localeCompare(b.name));
    const recs = rj(REC_FILE,[]);
    const today = todayCH();
    return emps.map(emp => {
      const t = recs.filter(r=>r.employee_id===emp.id&&r.timestamp.startsWith(today)).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
      const last = t[t.length-1]||null;
      return { id: emp.id, name: emp.name, status: last?.type||'absent', lastRecord: last };
    });
  },

  async addRecord(employee_id, type, photo_data) {
    if (USE_PG) {
      const r = await pool.query(
        'INSERT INTO records (employee_id,type,photo_data) VALUES ($1,$2,$3) RETURNING id',
        [employee_id, type, photo_data]);
      return r.rows[0].id;
    }
    const recs = rj(REC_FILE,[]);
    const rec = { id: nextId(recs), employee_id, type, timestamp: nowCH(), photo_data };
    recs.push(rec); wj(REC_FILE, recs);
    return rec.id;
  },

  async getEmployeeHoursToday(employee_id) {
    const today = todayCH();
    if (USE_PG) {
      const r = await pool.query(`
        SELECT type, to_char(timestamp AT TIME ZONE 'Europe/Zurich','YYYY-MM-DD"T"HH24:MI:SS') as timestamp
        FROM records WHERE employee_id=$1
        AND (timestamp AT TIME ZONE 'Europe/Zurich')::date = $2::date
        ORDER BY timestamp ASC`, [employee_id, today]);
      return calcHours({ records: r.rows });
    }
    const recs = rj(REC_FILE,[]).filter(r => r.employee_id === employee_id && r.timestamp.startsWith(today)).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
    return calcHours({ records: recs });
  },

  async getMonthlyHours(yearMonth) {
    if (USE_PG) {
      const emps = await pool.query('SELECT id, name FROM employees ORDER BY name');
      const r = await pool.query(`
        SELECT employee_id, type,
               to_char(timestamp AT TIME ZONE 'Europe/Zurich','YYYY-MM-DD"T"HH24:MI:SS') as timestamp
        FROM records
        WHERE to_char(timestamp AT TIME ZONE 'Europe/Zurich','YYYY-MM') = $1
        ORDER BY employee_id, timestamp ASC
      `, [yearMonth]);
      return emps.rows.map(emp => {
        const records = r.rows.filter(rec => rec.employee_id === emp.id);
        const { workMs, breakMs } = calcMs(records);
        return { id: emp.id, name: emp.name, work_time: fmtMs(workMs), break_time: fmtMs(breakMs), has_data: records.length > 0 };
      });
    }
    const emps = rj(EMP_FILE, []).sort((a,b) => a.name.localeCompare(b.name));
    const allRecs = rj(REC_FILE, []).filter(r => r.timestamp.startsWith(yearMonth)).sort((a,b) => a.timestamp.localeCompare(b.timestamp));
    return emps.map(emp => {
      const records = allRecs.filter(r => r.employee_id === emp.id);
      const { workMs, breakMs } = calcMs(records);
      return { id: emp.id, name: emp.name, work_time: fmtMs(workMs), break_time: fmtMs(breakMs), has_data: records.length > 0 };
    });
  },

  async deleteRecord(id) {
    if (USE_PG) { await pool.query('DELETE FROM records WHERE id=$1', [id]); return; }
    wj(REC_FILE, rj(REC_FILE,[]).filter(r => r.id !== id));
  },

  async getRecords(date) {
    const filterDate = date || todayCH();
    if (USE_PG) {
      const emps = await pool.query('SELECT id, name FROM employees');
      const empMap = Object.fromEntries(emps.rows.map(e=>[e.id, e.name]));
      const r = await pool.query(`
        SELECT id, employee_id, type, photo_data,
          to_char(timestamp AT TIME ZONE 'Europe/Zurich','YYYY-MM-DD"T"HH24:MI:SS') as timestamp
        FROM records
        WHERE (timestamp AT TIME ZONE 'Europe/Zurich')::date = $1::date
        ORDER BY employee_id, timestamp ASC`, [filterDate]);
      const byEmp = {};
      for (const row of r.rows) {
        if (!byEmp[row.employee_id]) byEmp[row.employee_id] = { employee_id: row.employee_id, employee_name: empMap[row.employee_id]||'?', records: [] };
        byEmp[row.employee_id].records.push(row);
      }
      return Object.values(byEmp).map(calcHours).sort((a,b)=>a.employee_name.localeCompare(b.employee_name));
    }
    const emps = rj(EMP_FILE,[]);
    const allRecs = rj(REC_FILE,[]).filter(r=>r.timestamp.startsWith(filterDate)).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
    const byEmp = {};
    for (const r of allRecs) {
      const emp = emps.find(e=>e.id===r.employee_id);
      if (!emp) continue;
      if (!byEmp[r.employee_id]) byEmp[r.employee_id] = { employee_id: r.employee_id, employee_name: emp.name, records: [] };
      byEmp[r.employee_id].records.push(r);
    }
    return Object.values(byEmp).map(calcHours).sort((a,b)=>a.employee_name.localeCompare(b.employee_name));
  }
};

module.exports = db;
