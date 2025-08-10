const $ = (q) => document.querySelector(q);
const api = (p, opts={}) =>
  fetch(p, { headers: { "Content-Type": "application/json" }, credentials: 'include', ...opts }).then(r=>r.json());
const fmt = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

const loginCard = $("#loginCard");
const app = $("#app");

async function checkAuth() {
  const me = await api('/api/auth/me');
  loginCard.classList.toggle('hidden', me.isAuthed);
  app.classList.toggle('hidden', !me.isAuthed);
  if (me.isAuthed) loadEvents();
}
checkAuth();

$("#loginForm").addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: $("#user").value, password: $("#pass").value })
  });
  if (res.ok) checkAuth(); else alert('Invalid credentials.');
});

const table = $("#evTable");
const rosterCard = $("#rosterCard");
const rosterBody = $("#rosterBody");
const positionsCard = $("#positionsCard");
const posEventTitle = $("#posEventTitle");
const posEventId = $("#posEventId");
const posTable = $("#posTable");

async function loadEvents() {
  const list = await api('/api/events');
  table.innerHTML = list.map(ev => `
    <tr class="border-t">
      <td class="py-2">${ev.title}</td>
      <td>${fmt(ev.starts_at)}${ev.ends_at ? ' – ' + fmt(ev.ends_at) : ''}</td>
      <td>${ev.count}${ev.capacity != null ? '/' + ev.capacity : ''}</td>
      <td class="text-right">
        <button class="btn" data-edit="${ev.id}">Edit</button>
        <button class="btn" data-positions="${ev.id}" data-title="${ev.title}">Positions</button>
        <button class="btn" data-roster="${ev.id}" data-title="${ev.title}">Roster</button>
        <button class="btn" data-del="${ev.id}">Delete</button>
      </td>
    </tr>
  `).join('');
}

table.addEventListener('click', async (e) => {
  const id = e.target.dataset.edit || e.target.dataset.roster || e.target.dataset.del || e.target.dataset.positions;
  if (!id) return;

  if (e.target.dataset.edit) {
    const ev = await (await fetch(`/api/events/${id}`)).json();
    fillForm(ev);
  }
  if (e.target.dataset.roster) {
    $("#rosterTitle").textContent = e.target.dataset.title;
    const rows = await api(`/api/events/${id}/signups`);
    rosterBody.innerHTML = rows.map(r => `
      <tr class="border-t"><td class="py-2">${r.name}</td><td>${r.position ?? ''}</td><td>${r.email ?? ''}</td><td>${r.phone ?? ''}</td><td>${fmt(r.created_at)}</td></tr>
    `).join('');
    rosterCard.classList.remove('hidden');
  }
  if (e.target.dataset.positions) {
    posEventTitle.textContent = e.target.dataset.title;
    posEventId.value = id;
    await loadPositions(id);
    positionsCard.classList.remove('hidden');
  }
  if (e.target.dataset.del) {
    if (!confirm('Delete this event?')) return;
    await api(`/api/events/${id}`, { method: 'DELETE' });
    loadEvents();
  }
});

$("#closeRoster").onclick = () => rosterCard.classList.add('hidden');
$("#closePositions").onclick = () => positionsCard.classList.add('hidden');

const form = $("#eventForm");
$("#newBtn").onclick = () => form.reset();
$("#resetBtn").onclick = () => form.reset();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: $("#evTitle").value.trim(),
    description: $("#evDesc").value.trim(),
    location: $("#evLoc").value.trim(),
    starts_at: $("#evStart").value,
    ends_at: $("#evEnd").value || null,
    capacity: $("#evCap").value === '' ? null : Number($("#evCap").value)
  };
  const id = $("#evId").value;
  if (id) {
    await api(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  } else {
    const res = await api('/api/events', { method: 'POST', body: JSON.stringify(payload) });
    $("#evId").value = res.id;
  }
  loadEvents();
  alert('Saved.');
});

function fillForm(ev) {
  $("#evId").value = ev.id;
  $("#evTitle").value = ev.title ?? '';
  $("#evDesc").value = ev.description ?? '';
  $("#evLoc").value = ev.location ?? '';
  $("#evStart").value = ev.starts_at?.slice(0,16) ?? '';
  $("#evEnd").value = ev.ends_at ? ev.ends_at.slice(0,16) : '';
  $("#evCap").value = ev.capacity ?? '';
}

// Positions management
async function loadPositions(eventId) {
  const rows = await api(`/api/events/${eventId}/positions`);
  posTable.innerHTML = rows.map(p => `
    <tr class="border-t">
      <td class="py-2">${p.name}</td>
      <td>${p.capacity}</td>
      <td>${p.count}</td>
      <td class="text-right"><button class="btn" data-delpos="${p.id}">Delete</button></td>
    </tr>
  `).join('');
}

$("#posForm").addEventListener('submit', async (e) => {
  e.preventDefault();
  const eventId = $("#posEventId").value;
  const payload = { name: $("#posName").value.trim(), capacity: Number($("#posCap").value) };
  await api(`/api/events/${eventId}/positions`, { method: 'POST', body: JSON.stringify(payload) });
  $("#posName").value = ''; $("#posCap").value = '';
  loadPositions(eventId);
});

posTable.addEventListener('click', async (e) => {
  const id = e.target.dataset.delpos;
  if (!id) return;
  if (!confirm('Delete this position?')) return;
  await api(`/api/positions/${id}`, { method: 'DELETE' });
  loadPositions($("#posEventId").value);
});