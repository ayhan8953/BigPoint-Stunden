const express = require('express');
const path = require('path');
const os = require('os');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Bis 500KB JSON für Base64-Fotos
app.use(express.json({ limit: '500kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Login ─────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN fehlt' });
    const result = await db.login(pin);
    if (!result) return res.status(401).json({ error: 'Falsche PIN' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Mitarbeiter ───────────────────────────────────────────────────────────
app.get('/api/employees', async (req, res) => {
  try {
    const emps = await db.getEmployees();
    res.json(emps);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/employees', async (req, res) => {
  try {
    const { name, pin } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN muss 4 Ziffern sein' });
    const all = await db.getEmployees();
    if (all.find(e => e.name.toLowerCase() === name.trim().toLowerCase()))
      return res.status(400).json({ error: 'Mitarbeiter existiert bereits' });
    if (await db.isPinTaken(pin))
      return res.status(400).json({ error: 'Diese PIN ist bereits vergeben' });
    const emp = await db.addEmployee(name.trim(), pin);
    res.json(emp);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    await db.deleteEmployee(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/employees/:id/pin', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { pin } = req.body;
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN muss 4 Ziffern sein' });
    if (await db.isPinTaken(pin, id))
      return res.status(400).json({ error: 'Diese PIN ist bereits vergeben' });
    await db.updateEmployeePin(id, pin);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin PIN ─────────────────────────────────────────────────────────────
app.put('/api/admin/pin', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN muss 4 Ziffern sein' });
    if (await db.isPinTaken(pin))
      return res.status(400).json({ error: 'Diese PIN ist bereits von einem Mitarbeiter vergeben' });
    await db.updateAdminPin(pin);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Live-Status ───────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  try { res.json(await db.getStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Eintrag speichern ─────────────────────────────────────────────────────
app.post('/api/record', async (req, res) => {
  try {
    const { employee_id, type, photo_data } = req.body;
    if (!employee_id || !type) return res.status(400).json({ error: 'Fehlende Felder' });
    const valid = ['check_in', 'break_start', 'break_end', 'check_out'];
    if (!valid.includes(type)) return res.status(400).json({ error: 'Ungültiger Typ' });

    await db.addRecord(parseInt(employee_id), type, photo_data || null);

    const msgs = {
      check_in:    'Guten Tag! Schicht begonnen.',
      break_start: 'Geniesse deine Pause!',
      break_end:   'Willkommen zurück!',
      check_out:   'Tschüss! Schicht beendet.'
    };
    res.json({ success: true, message: msgs[type] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Aufzeichnungen ────────────────────────────────────────────────────────
app.get('/api/records', async (req, res) => {
  try { res.json(await db.getRecords(req.query.date)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────
async function start() {
  await db.init();
  app.listen(PORT, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    let localIP = '???';
    for (const n of Object.values(nets).flat()) {
      if (n.family === 'IPv4' && !n.internal) { localIP = n.address; break; }
    }
    const mode = process.env.DATABASE_URL ? 'PostgreSQL (Cloud)' : 'JSON (Lokal)';
    console.log('\n  ╔══════════════════════════════════════╗');
    console.log('  ║   BigPoint Stunden — Zeiterfassung   ║');
    console.log('  ╠══════════════════════════════════════╣');
    if (!process.env.DATABASE_URL) {
      console.log(`  ║  Lokal:   http://localhost:${PORT}       ║`);
      console.log(`  ║  Handy:   http://${localIP}:${PORT}  ║`);
    }
    console.log(`  ║  Modus:   ${mode.padEnd(26)}║`);
    console.log('  ╚══════════════════════════════════════╝\n');
  });
}

start().catch(err => { console.error('Startfehler:', err); process.exit(1); });
