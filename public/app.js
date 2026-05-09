const App = (() => {
  let pinValue = '';
  let currentEmployee = null;
  let currentAction = null;
  let capturedPhoto = null;
  let cameraStream = null;
  let pinChangeTargetId = null;
  let currentAdminId = null;

  const statusMap = {
    absent:      { label: 'Nicht anwesend', css: 'status-absent',   icon: '⭕' },
    check_in:    { label: 'Am Arbeiten',    css: 'status-working',  icon: '✅' },
    break_start: { label: 'In der Pause',   css: 'status-break',    icon: '☕' },
    break_end:   { label: 'Am Arbeiten',    css: 'status-working',  icon: '✅' },
    check_out:   { label: 'Feierabend',     css: 'status-checkout', icon: '🏠' }
  };

  const actionMap = {
    check_in:    { label: 'Schicht beginnen', css: 'btn-success', icon: '🟢', title: 'Foto — Arbeitsbeginn' },
    break_start: { label: 'Pause beginnen',   css: 'btn-warning', icon: '☕', title: 'Foto — Pausenbeginn' },
    break_end:   { label: 'Pause beenden',    css: 'btn-primary', icon: '🔵', title: 'Foto — Pausenende' },
    check_out:   { label: 'Feierabend',       css: 'btn-danger',  icon: '🏠', title: 'Foto — Feierabend' }
  };

  function getAvailableActions(status) {
    const map = {
      absent:      ['check_in'],
      check_in:    ['break_start', 'check_out'],
      break_start: ['break_end'],
      break_end:   ['break_start', 'check_out'],
      check_out:   []
    };
    return map[status] || ['check_in'];
  }

  function getInitials(name) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  const COLORS = ['#2563EB','#DC2626','#7C3AED','#059669','#D97706','#0891B2','#DB2777','#65A30D'];
  function avatarColor(name) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return COLORS[Math.abs(h) % COLORS.length];
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatDateTime(ts) {
    return new Date(ts).toLocaleString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${id}`);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
  }

  // ── Clock ─────────────────────────────────────────────────────────────────
  function updateClock() {
    const el = document.getElementById('header-time');
    if (el) el.textContent = new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ── PIN ───────────────────────────────────────────────────────────────────
  function updateDots() {
    const dots = document.querySelectorAll('#pin-dots .dot');
    dots.forEach((d, i) => d.classList.toggle('filled', i < pinValue.length));
  }

  function pinPress(digit) {
    if (pinValue.length >= 4) return;
    pinValue += digit;
    updateDots();
    hideError();
    if (pinValue.length === 4) {
      setTimeout(submitPin, 100);
    }
  }

  function pinDelete() {
    if (pinValue.length === 0) return;
    pinValue = pinValue.slice(0, -1);
    updateDots();
    hideError();
  }

  function hideError() {
    document.getElementById('pin-error').style.visibility = 'hidden';
  }

  function showPinError() {
    const el = document.getElementById('pin-error');
    el.style.visibility = 'visible';
    // Numpad schütteln
    document.querySelector('.numpad').classList.add('shake');
    setTimeout(() => document.querySelector('.numpad').classList.remove('shake'), 400);
    pinValue = '';
    updateDots();
  }

  async function submitPin() {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinValue })
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        showPinError();
        return;
      }

      hideError();
      pinValue = '';
      updateDots();

      if (data.type === 'admin') {
        currentAdminId = data.adminId;
        currentEmployee = { name: data.name };
        showScreen('admin');
        initAdmin();
      } else if (data.type === 'employee') {
        showActionScreen(data.employee);
      }
    } catch {
      showPinError();
    }
  }

  // ── Action Screen ─────────────────────────────────────────────────────────
  function showActionScreen(emp) {
    currentEmployee = emp;
    const s = statusMap[emp.status] || statusMap.absent;

    const av = document.getElementById('action-avatar');
    av.textContent = getInitials(emp.name);
    av.style.background = avatarColor(emp.name);

    document.getElementById('action-name').textContent = emp.name;
    const badge = document.getElementById('action-status-badge');
    badge.textContent = `${s.icon} ${s.label}`;
    badge.className = `status-badge ${s.css}`;

    const actions = getAvailableActions(emp.status);
    const btns = document.getElementById('action-buttons');

    if (actions.length === 0) {
      btns.innerHTML = `<div class="empty">Feierabend wurde bereits gemacht.<br>Bis morgen! 👋</div>`;
    } else {
      btns.innerHTML = actions.map(type => {
        const a = actionMap[type];
        return `<button class="btn ${a.css}" onclick="App.startAction('${type}')">
          <span class="action-icon">${a.icon}</span>${a.label}
        </button>`;
      }).join('');
    }

    showScreen('action');
  }

  function logout() {
    stopCamera();
    currentEmployee = null;
    currentAction = null;
    capturedBlob = null;
    pinValue = '';
    updateDots();
    hideError();
    showScreen('pin');
  }

  // ── Camera ────────────────────────────────────────────────────────────────
  async function startAction(type) {
    currentAction = type;
    document.getElementById('camera-title').textContent = actionMap[type].title;
    showScreen('camera');
    await startCamera();
  }

  async function startCamera() {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }
      });
      document.getElementById('camera-video').srcObject = cameraStream;
    } catch (err) {
      alert('Kamera konnte nicht gestartet werden.\nBitte Kamera-Berechtigung im Browser erlauben.\n\n' + err.message);
      showScreen('action');
    }
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
  }

  function capturePhoto() {
    const video = document.getElementById('camera-video');
    // Foto auf max 640px Breite skalieren, spart Speicher
    const MAX_W = 640;
    const scale = Math.min(1, MAX_W / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(video.videoWidth  * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    capturedPhoto = canvas.toDataURL('image/jpeg', 0.75);
    document.getElementById('preview-image').src = capturedPhoto;
    stopCamera();
    showScreen('preview');
  }

  function retakePhoto() {
    capturedPhoto = null;
    showScreen('camera');
    startCamera();
  }

  function cancelCamera() {
    stopCamera();
    currentAction = null;
    showScreen('action');
  }

  async function confirmPhoto() {
    if (!capturedPhoto || !currentEmployee || !currentAction) return;
    const btn = document.getElementById('confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Speichere...';

    try {
      const res = await fetch('/api/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: currentEmployee.id,
          type: currentAction,
          photo_data: capturedPhoto
        })
      });
      const data = await res.json();

      if (data.success) {
        document.getElementById('success-message').textContent = data.message;
        document.getElementById('success-time').textContent = formatDateTime(new Date().toISOString());
        const hoursEl = document.getElementById('success-hours');
        if (data.hours) {
          hoursEl.textContent = `Gearbeitet: ${data.hours.work_time}  |  Pause: ${data.hours.break_time}`;
          hoursEl.style.display = 'block';
        } else {
          hoursEl.style.display = 'none';
        }
        showScreen('success');
        setTimeout(() => logout(), 5000);
      } else {
        alert('Fehler: ' + (data.error || 'Unbekannter Fehler'));
        btn.disabled = false;
        btn.textContent = '✓ Bestätigen';
      }
    } catch {
      alert('Verbindungsfehler. Bitte erneut versuchen.');
      btn.disabled = false;
      btn.textContent = '✓ Bestätigen';
    }
  }

  // ── Admin ─────────────────────────────────────────────────────────────────
  let currentMonth = new Date().toLocaleDateString('sv-SE').slice(0, 7);

  function initAdmin() {
    document.getElementById('admin-title').textContent = `\u{1F451} ${currentEmployee?.name || 'Admin'}`;
    document.getElementById('admin-date').value = new Date().toLocaleDateString('sv-SE');
    loadLiveStatus();
    adminTab('records');
  }

  function adminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach((t, i) => {
      t.classList.toggle('active', ['records','monthly','employees','pin'][i] === tab);
    });
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`admin-tab-${tab}`).classList.add('active');
    if (tab === 'records')   loadRecords();
    if (tab === 'monthly')   loadMonthly();
    if (tab === 'employees') loadEmployeeList();
  }

  function prevMonth() {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    currentMonth = d.toLocaleDateString('sv-SE').slice(0, 7);
    loadMonthly();
  }
  function nextMonth() {
    const [y, m] = currentMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    currentMonth = d.toLocaleDateString('sv-SE').slice(0, 7);
    loadMonthly();
  }

  async function loadMonthly() {
    const el = document.getElementById('monthly-hours');
    el.innerHTML = '<div class="loading">Lade...</div>';
    const [y, m] = currentMonth.split('-').map(Number);
    document.getElementById('month-label').textContent =
      new Date(y, m - 1, 1).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
    try {
      const data = await (await fetch(`/api/monthly?month=${currentMonth}`)).json();
      if (!data.length) { el.innerHTML = '<div class="empty">Keine Mitarbeiter.</div>'; return; }
      el.innerHTML = `<table class="monthly-table">
        <thead><tr><th>Mitarbeiter</th><th>Arbeitszeit</th><th>Pausenzeit</th></tr></thead>
        <tbody>
          ${data.map(e => `<tr class="${!e.has_data ? 'no-data' : ''}">
            <td class="emp-col">${esc(e.name)}</td>
            <td class="hours-col">${e.has_data ? `<strong>${esc(e.work_time)}</strong>` : '<span style="color:#ccc">—</span>'}</td>
            <td class="break-col">${e.has_data ? esc(e.break_time) : '<span style="color:#ccc">—</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    } catch { el.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  async function loadLiveStatus() {
    const grid = document.getElementById('admin-live');
    try {
      const res = await fetch('/api/status');
      const employees = await res.json();
      if (employees.length === 0) { grid.innerHTML = '<div class="empty">Keine Mitarbeiter</div>'; return; }

      grid.innerHTML = employees.map(e => {
        const s = statusMap[e.status] || statusMap.absent;
        return `<div class="live-row">
          <div class="live-avatar" style="background:${avatarColor(e.name)}">${getInitials(e.name)}</div>
          <div>
            <div class="live-name">${esc(e.name)}</div>
            ${e.lastRecord ? `<div style="font-size:0.78rem;color:var(--muted)">seit ${formatTime(e.lastRecord.timestamp)}</div>` : ''}
          </div>
          <span class="live-status ${s.css}">${s.icon} ${s.label}</span>
        </div>`;
      }).join('');
    } catch { grid.innerHTML = '<div class="empty">Fehler</div>'; }
  }

  async function loadEmployeeList() {
    const list = document.getElementById('employee-list');
    try {
      const res = await fetch('/api/employees');
      const employees = await res.json();
      if (employees.length === 0) { list.innerHTML = '<div class="empty">Keine Mitarbeiter</div>'; return; }
      list.innerHTML = employees.map(e => `
        <div class="emp-row">
          <div class="live-avatar" style="background:${avatarColor(e.name)};width:34px;height:34px;font-size:0.85rem">${getInitials(e.name)}</div>
          <div class="emp-row-name">${esc(e.name)}</div>
          <div class="emp-row-pin">${esc(e.pin)}</div>
          <div class="emp-row-actions">
            <button class="icon-btn" onclick="App.openPinModal(${e.id}, '${esc(e.name)}')" title="PIN ändern">✏️</button>
            <button class="icon-btn del" onclick="App.deleteEmployee(${e.id}, '${esc(e.name)}')" title="Löschen">🗑️</button>
          </div>
        </div>`).join('');
    } catch { list.innerHTML = '<div class="empty">Fehler</div>'; }
  }

  function showAddForm() {
    document.getElementById('add-form').style.display = 'flex';
    document.getElementById('show-add-btn').style.display = 'none';
    document.getElementById('new-emp-name').focus();
  }

  function hideAddForm() {
    document.getElementById('add-form').style.display = 'none';
    document.getElementById('show-add-btn').style.display = 'block';
    document.getElementById('new-emp-name').value = '';
    document.getElementById('new-emp-pin').value = '';
  }

  async function addEmployee() {
    const name = document.getElementById('new-emp-name').value.trim();
    const pin = document.getElementById('new-emp-pin').value.trim();

    if (!name) { alert('Bitte Namen eingeben.'); return; }
    if (!/^\d{4}$/.test(pin)) { alert('PIN muss genau 4 Ziffern sein.'); return; }

    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      hideAddForm();
      loadEmployeeList();
      loadLiveStatus();
    } catch { alert('Fehler beim Hinzufügen.'); }
  }

  async function deleteEmployee(id, name) {
    if (!confirm(`Mitarbeiter "${name}" wirklich löschen?\nAlle Einträge werden ebenfalls gelöscht.`)) return;
    try {
      await fetch(`/api/employees/${id}`, { method: 'DELETE' });
      loadEmployeeList();
      loadLiveStatus();
    } catch { alert('Fehler beim Löschen.'); }
  }

  function openPinModal(id, name) {
    pinChangeTargetId = id;
    document.getElementById('pin-modal-title').textContent = `PIN ändern — ${name}`;
    document.getElementById('pin-modal-input').value = '';
    document.getElementById('pin-modal').classList.add('open');
    setTimeout(() => document.getElementById('pin-modal-input').focus(), 100);
  }

  function closePinModal() {
    document.getElementById('pin-modal').classList.remove('open');
    pinChangeTargetId = null;
  }

  async function saveNewPin() {
    const pin = document.getElementById('pin-modal-input').value.trim();
    if (!/^\d{4}$/.test(pin)) { alert('PIN muss genau 4 Ziffern sein.'); return; }

    try {
      const res = await fetch(`/api/employees/${pinChangeTargetId}/pin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      closePinModal();
      loadEmployeeList();
    } catch { alert('Fehler beim Ändern.'); }
  }

  async function changeAdminPin() {
    const pin = document.getElementById('admin-new-pin').value.trim();
    if (!/^\d{4}$/.test(pin)) { alert('PIN muss genau 4 Ziffern sein.'); return; }
    try {
      const res = await fetch('/api/admin/pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: currentAdminId, pin })
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      document.getElementById('admin-new-pin').value = '';
      alert('Admin PIN wurde geändert.');
    } catch { alert('Fehler beim Ändern.'); }
  }

  async function loadRecords() {
    const date = document.getElementById('admin-date').value;
    const container = document.getElementById('admin-records');
    container.innerHTML = '<div class="loading">Lade Einträge...</div>';
    try {
      const res = await fetch(`/api/records?date=${date}`);
      const summaries = await res.json();
      if (summaries.length === 0) {
        container.innerHTML = '<div class="empty">Keine Einträge für diesen Tag.</div>';
        return;
      }
      container.innerHTML = summaries.map(s => `
        <div class="employee-summary">
          <div class="summary-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
            <div>
              <div class="summary-name">${esc(s.employee_name)}</div>
              <div class="summary-hours">Arbeit: ${s.work_time} &nbsp;|&nbsp; Pause: ${s.break_time}</div>
            </div>
            <span>▾</span>
          </div>
          <div class="summary-body">
            ${s.records.map(r => `
              <div class="record-row" id="rec-${r.id}">
                <div class="record-type type-${r.type}">${typeLabel(r.type)}</div>
                <div class="record-time">${formatTime(r.timestamp)}</div>
                ${r.photo_data
                  ? `<img class="record-photo" src="${r.photo_data}" alt="Foto" onclick="App.openModal('${r.photo_data}')">`
                  : `<div class="no-photo">kein Foto</div>`}
                <button class="del-rec-btn" onclick="App.deleteRecord(${r.id})" title="Eintrag löschen">🗑️</button>
              </div>`).join('')}
          </div>
        </div>`).join('');
    } catch { container.innerHTML = '<div class="empty">Fehler beim Laden.</div>'; }
  }

  function typeLabel(type) {
    const labels = {
      check_in:    '🟢 Arbeit begonnen',
      break_start: '☕ Pause begonnen',
      break_end:   '🔵 Pause beendet',
      check_out:   '🏠 Feierabend'
    };
    return labels[type] || type;
  }

  async function deleteRecord(id) {
    if (!confirm('Diesen Eintrag wirklich löschen?')) return;
    try {
      await fetch(`/api/records/${id}`, { method: 'DELETE' });
      loadRecords();
    } catch { alert('Fehler beim Löschen.'); }
  }

  function openModal(src) {
    document.getElementById('modal-image').src = src;
    document.getElementById('photo-modal').classList.add('open');
  }

  function closeModal() {
    document.getElementById('photo-modal').classList.remove('open');
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const screen = document.querySelector('.screen.active');
    if (!screen || screen.id !== 'screen-pin') return;
    if (e.key >= '0' && e.key <= '9') pinPress(e.key);
    else if (e.key === 'Backspace') pinDelete();
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    updateClock();
    setInterval(updateClock, 1000);
    showScreen('pin');
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    pinPress, pinDelete, logout,
    startAction, capturePhoto, retakePhoto, cancelCamera, confirmPhoto,
    showAddForm, hideAddForm, addEmployee, deleteEmployee,
    openPinModal, closePinModal, saveNewPin, changeAdminPin,
    loadRecords, openModal, closeModal, deleteRecord,
    adminTab, prevMonth, nextMonth
  };
})();
