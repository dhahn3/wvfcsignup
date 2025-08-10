const $ = (q) => document.querySelector(q);
const eventsEl = $("#events");
const dlg = $("#signupDialog");
const resultBox = $("#signupResult");
const formBox = $("#signupForm");
const posWrap = $("#positionWrap");
const suPosition = $("#suPosition");

const mySignups = JSON.parse(localStorage.getItem("mySignups") || "[]");
const saveMy = () => localStorage.setItem("mySignups", JSON.stringify(mySignups));

const api = (p, opts={}) =>
  fetch(p, { headers: { "Content-Type": "application/json" }, ...opts }).then(r=>r.json());

const fmt = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

function positionsList(ev) {
  if (!ev.positions || ev.positions.length === 0) return '';
  return `
  <div class="mt-2 border rounded-xl">
    ${ev.positions.map(p => `
      <div class="flex items-center justify-between px-3 py-2 ${p.count >= p.capacity ? 'opacity-60' : ''}">
        <div class="text-sm"><span class="font-medium">${p.name}</span></div>
        <div class="flex items-center gap-2">
          <span class="text-xs px-2 py-1 rounded-full ${p.count>=p.capacity?'bg-rose-100 text-rose-700':'bg-emerald-100 text-emerald-700'}">${p.count}/${p.capacity}</span>
          <button class="btn btn-primary" data-su="${ev.id}" data-position="${p.id}" ${p.count>=p.capacity?'disabled':''}>Sign up</button>
        </div>
      </div>
    `).join('')}
  </div>`;
}

function card(ev) {
  const countText = ev.capacity != null ? `${ev.count}/${ev.capacity}` : `${ev.count}`;
  const full = ev.positions?.length ? false : (ev.capacity != null && ev.count >= ev.capacity);
  const mine = mySignups.find((s) => s.eventId === ev.id);
  return `
  <article class="card flex flex-col gap-3">
    <div class="flex items-start justify-between gap-3">
      <h2 class="text-lg font-semibold">${ev.title}</h2>
      <span class="text-sm px-2 py-1 rounded-full ${full ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}">
        ${countText} signed
      </span>
    </div>
    <div class="text-sm text-slate-600">${ev.description ?? ''}</div>
    <div class="text-sm">
      <div><span class="font-medium">When:</span> ${fmt(ev.starts_at)}${ev.ends_at ? ' – ' + fmt(ev.ends_at) : ''}</div>
      ${ev.location ? `<div><span class="font-medium">Where:</span> ${ev.location}</div>` : ''}
    </div>
    ${positionsList(ev)}
    <div class="flex gap-2 justify-end">
      ${
        mine
          ? `<button class="btn" data-cancel="${ev.id}">Remove me</button>`
          : `${(ev.positions && ev.positions.length>0) ? '' : `<button class="btn btn-primary" data-su="${ev.id}" ${full ? 'disabled' : ''}>Sign up</button>`}`
      }
    </div>
  </article>`;
}

async function load() {
  const list = await api('/api/events');
  eventsEl.innerHTML = list.map(card).join('');
}

eventsEl.addEventListener('click', async (e) => {
  const suId = e.target.dataset.su;
  const cancelEventId = e.target.dataset.cancel;
  const positionId = e.target.dataset.position;

  if (suId) {
    const ev = await api(`/api/events/${suId}`);
    $("#dlgEventId").value = ev.id;
    $("#dlgTitle").textContent = ev.title;
    formBox.reset();
    resultBox.classList.add('hidden');
    formBox.classList.remove('hidden');

    if (ev.positions && ev.positions.length > 0) {
      posWrap.classList.remove('hidden');
      suPosition.innerHTML = ev.positions.map(p => `<option value="${p.id}" ${positionId && Number(positionId)===p.id ? 'selected' : ''} ${p.count>=p.capacity?'disabled':''}>${p.name} (${p.count}/${p.capacity})</option>`).join('');
    } else {
      posWrap.classList.add('hidden');
      suPosition.innerHTML = '';
    }

    dlg.showModal();
  }
  if (cancelEventId) {
    const mine = mySignups.find((s) => s.eventId === Number(cancelEventId));
    if (!mine) return;
    const url = `/api/events/${mine.eventId}/signup/${mine.signupId}?token=${encodeURIComponent(mine.token)}`;
    const res = await api(url, { method: 'DELETE' });
    if (res.ok) {
      const idx = mySignups.findIndex((s) => s.eventId === Number(cancelEventId));
      mySignups.splice(idx, 1); saveMy();
      await load();
      alert('Removed.');
    } else {
      alert(res.error || 'Failed to remove.');
    }
  }
});

formBox.addEventListener('submit', async (e) => {
  e.preventDefault();
  const eventId = Number($("#dlgEventId").value);
  const body = {
    name: $("#suName").value.trim(),
    email: $("#suEmail").value.trim(),
    phone: $("#suPhone").value.trim(),
    position_id: suPosition.value ? Number(suPosition.value) : null
  };
  const res = await api(`/api/events/${eventId}/signup`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  if (res.ok) {
    const entry = { eventId, signupId: res.signupId, token: res.cancelToken };
    mySignups.push(entry); saveMy();
    $("#cancelCode").textContent = res.cancelToken;
    const cancelHref = `/api/events/${eventId}/signup/${res.signupId}?token=${encodeURIComponent(res.cancelToken)}`;
    const cancelLink = $("#cancelLink");
    cancelLink.href = cancelHref;
    cancelLink.setAttribute('target','_blank');
    formBox.classList.add('hidden');
    resultBox.classList.remove('hidden');
    await load();
  } else {
    alert(res.error || 'Could not sign up.');
  }
});

load();