'use strict';
/* Málaga en familia · app del viaje
   - El plan, los restaurantes y las reservas salen de data/viaje.json (solo lo cambia Gerardo).
   - Votos, tareas y gastos se guardan en Supabase, protegidos por la clave familiar. */

const CFG = window.MALAGA_CONFIG || {};
const BACKEND = !!(CFG.supabaseUrl && CFG.supabaseKey);

const store = {
  get(k){ try{ return JSON.parse(localStorage.getItem('malaga.' + k)); }catch{ return null; } },
  set(k, v){ try{ localStorage.setItem('malaga.' + k, JSON.stringify(v)); }catch{} },
  del(k){ try{ localStorage.removeItem('malaga.' + k); }catch{} }
};

const S = {
  viaje: null,
  view: 'plan',
  dia: null,
  clave: store.get('clave'),
  yo: store.get('yo'),
  datos: null,
  error: null,
  busy: false,
  draftTarea: { titulo: '', dia: '' },
  draftGasto: null,
  confirmar: null,
  installPrompt: null
};

/* ── Utilidades ─────────────────────────────────────────────────────────── */
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)){
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)){
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}
const ICONS = {
  plan: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  reservas: '<svg viewBox="0 0 24 24"><path d="M9 11.5l2 2 4-4.5"/><rect x="4" y="4" width="16" height="16" rx="3"/></svg>',
  comer: '<svg viewBox="0 0 24 24"><path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8M7 7h4M16.5 3c-1.7 0-2.5 2.5-2.5 5.5S15 13 16.5 13V21"/></svg>',
  tareas: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L6.8 5M3.5 12l1.2 1.2 2.1-2.2M3.5 18l1.2 1.2 2.1-2.2"/></svg>',
  gastos: '<svg viewBox="0 0 24 24"><path d="M17 6.5A6.5 6.5 0 1 0 17 17.5"/><path d="M4.5 10.5h9M4.5 13.5h9"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/></svg>'
};
function icon(name){ const s = document.createElement('span'); s.innerHTML = ICONS[name]; return s.firstChild; }

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const fmt = cents => eur.format(cents / 100);
const mapa = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
const telHref = t => 'tel:+34' + t.replace(/\D/g, '');

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

function hoyISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ── Conexión con la base de datos ──────────────────────────────────────── */
async function rpc(fn, args){
  const url = CFG.supabaseUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '') + '/rest/v1/rpc/' + fn;
  const headers = { apikey: CFG.supabaseKey, 'Content-Type': 'application/json' };
  if (/^eyJ/.test(CFG.supabaseKey)) headers.Authorization = 'Bearer ' + CFG.supabaseKey;
  const r = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(args)
  });
  const txt = await r.text();
  let body = null; try{ body = txt ? JSON.parse(txt) : null; }catch{}
  if (!r.ok){
    const msg = (body && (body.message || body.hint)) || ('Error ' + r.status);
    const e = new Error(msg); e.clave = /clave_incorrecta/.test(msg); throw e;
  }
  return body;
}

async function sync(opts = {}){
  if (!BACKEND || !S.clave) return;
  try{
    S.datos = await rpc('estado', { p_clave: S.clave });
    S.error = null;
    if (S.yo && !S.datos.personas.some(p => p.id === S.yo.id)){ S.yo = null; store.del('yo'); }
  }catch(e){
    if (e.clave){
      S.clave = null; S.datos = null; store.del('clave');
      toast('La clave familiar ha cambiado. Vuelve a entrar.');
    } else {
      S.error = 'Sin conexión con la base de datos. Lo compartido puede no estar al día.';
    }
  }
  if (opts.quiet && editing()) return;   // no pisar lo que alguien está escribiendo
  render();
}
function editing(){
  const a = document.activeElement;
  return a && a.closest && a.closest('#main, #sheet') && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName);
}

async function act(fn, args, okMsg){
  if (S.busy) return false;
  S.busy = true; render();
  try{
    await rpc(fn, Object.assign({ p_clave: S.clave }, args));
    if (okMsg) toast(okMsg);
    S.busy = false;
    await sync();
    return true;
  }catch(e){
    S.busy = false;
    if (e.clave){ S.clave = null; S.datos = null; store.del('clave'); toast('La clave familiar ha cambiado. Vuelve a entrar.'); }
    else toast('No se ha podido guardar. Revisa la conexión y prueba otra vez.');
    render();
    return false;
  }
}

const personas = () => (S.datos && S.datos.personas) || [];
const nombre = id => (personas().find(p => p.id === id) || {}).nombre || 'Alguien';

/* ── Cabecera ───────────────────────────────────────────────────────────── */
function renderHeader(){
  document.getElementById('countdown').textContent = '28 dic 2026 – 2 ene 2027 · Pedregalejo';
  const who = document.getElementById('who');
  who.replaceChildren();
  if (!BACKEND) return;
  if (S.clave && S.yo){
    who.append(h('button', { class: 'who-btn', type: 'button', onclick: () => abrirEntrada(2), 'aria-label': 'Cambiar de persona' },
      h('span', { class: 'av', 'aria-hidden': 'true' }, S.yo.nombre.trim().charAt(0).toUpperCase()),
      h('span', { class: 'n' }, S.yo.nombre)));
  } else {
    who.append(h('button', { class: 'who-btn out', type: 'button', onclick: () => abrirEntrada(S.clave ? 2 : 1) }, 'Entrar'));
  }
}

/* ── Cuenta atrás ───────────────────────────────────────────────────────── */
const SALIDA = new Date('2026-12-28T00:00:00+01:00');
const FIN = new Date('2027-01-03T00:00:00+01:00');
function cuentaAtras(){
  const box = document.getElementById('cd');
  const ahora = new Date();
  if (ahora >= FIN){ box.hidden = true; return; }
  if (ahora >= SALIDA){
    const n = Math.floor((ahora - SALIDA) / 864e5) + 1;
    if (box.dataset.modo !== 'live' + n){
      box.dataset.modo = 'live' + n;
      box.replaceChildren(h('div', { class: 'cd-box live' },
        h('div', null, h('div', { class: 'cd-label' }, 'Ya estamos en Málaga'), h('div', { class: 'cd-sub' }, 'Día ' + n + ' de 6 del viaje'))));
    }
    return;
  }
  let t = Math.floor((SALIDA - ahora) / 1000);
  const d = Math.floor(t / 86400); t -= d * 86400;
  const hh = Math.floor(t / 3600); t -= hh * 3600;
  const mm = Math.floor(t / 60); const ss = t - mm * 60;
  if (box.dataset.modo !== 'cuenta'){
    box.dataset.modo = 'cuenta';
    const u = (id, label, cls) => h('div', { class: 'cd-u' + (cls ? ' ' + cls : '') }, h('b', { id }), h('span', null, label));
    box.replaceChildren(h('div', { class: 'cd-box', role: 'timer', 'aria-label': 'Cuenta atrás hasta el viaje' },
      h('div', null, h('div', { class: 'cd-label' }, 'Cuenta atrás'), h('div', { class: 'cd-sub' }, 'Hasta el lunes 28 de diciembre')),
      h('div', { class: 'cd-units' }, u('cd-d', d === 1 ? 'día' : 'días', 'cd-days'), u('cd-h', 'horas'), u('cd-m', 'min'), u('cd-s', 'seg'))));
  }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('cd-d', d); set('cd-h', String(hh).padStart(2, '0')); set('cd-m', String(mm).padStart(2, '0')); set('cd-s', String(ss).padStart(2, '0'));
}

function renderBanner(){
  const b = document.getElementById('banner');
  b.replaceChildren();
  b.hidden = !S.error;
  if (S.error) b.append(h('div', { class: 'banner' }, S.error));
}

/* ── Barra de pestañas ──────────────────────────────────────────────────── */
const TABS = [
  ['plan', 'Plan'], ['reservas', 'Reservas'], ['comer', 'Comer'],
  ['tareas', 'Tareas'], ['gastos', 'Gastos'], ['info', 'Info']
];
function renderTabs(){
  const nav = document.getElementById('tabbar');
  const pend = S.datos ? S.datos.tareas.filter(t => !t.hecha).length : 0;
  nav.replaceChildren(h('div', { class: 'tabbar-in' }, TABS.map(([id, label]) =>
    h('a', { class: 'tab', href: '#' + (id === 'plan' ? (S.dia || 'plan') : id), 'aria-current': S.view === id ? 'page' : null },
      icon(id), label,
      id === 'tareas' && pend ? h('span', { class: 'dot', 'aria-label': pend + ' pendientes' }, pend) : null))));
}

/* ── Votos ──────────────────────────────────────────────────────────────── */
function votos(item){
  if (!BACKEND) return null;
  const vs = (S.datos ? S.datos.votos : []).filter(v => v.item === item);
  const si = vs.filter(v => v.valor === 1), no = vs.filter(v => v.valor === -1);
  const mio = S.yo ? ((vs.find(v => v.persona === S.yo.id) || {}).valor || 0) : 0;
  const pulsar = val => {
    if (!S.clave || !S.yo){ abrirEntrada(S.clave ? 2 : 1); return; }
    act('votar', { p_item: item, p_persona: S.yo.id, p_valor: mio === val ? 0 : val });
  };
  const btn = (val, label, list) => h('button', {
    class: 'vote', type: 'button', 'data-v': String(val), 'aria-pressed': String(mio === val),
    disabled: S.busy || null, onclick: () => pulsar(val)
  }, label, h('b', null, S.datos ? list.length : '·'));
  const out = [h('div', { class: 'votes' }, btn(1, 'Me apetece', si), btn(-1, 'Mejor otra cosa', no))];
  const partes = [];
  if (si.length) partes.push('Les apetece: ' + si.map(v => nombre(v.persona)).join(', '));
  if (no.length) partes.push('Prefieren otra cosa: ' + no.map(v => nombre(v.persona)).join(', '));
  if (partes.length) out.push(h('p', { class: 'who-voted' }, partes.join(' · ')));
  return out;
}

/* ── Vista: plan ─────────────────────────────────────────────────────────── */
function chipEls(chips){
  return chips && chips.length ? h('div', { class: 'chips' }, chips.map(c => h('span', { class: 'chip ' + c.k }, c.t))) : null;
}
function viewPlan(){
  const v = S.viaje;
  const hoy = hoyISO();
  const fechaDe = d => {
    const mes = d.mo === 'dic' ? '12' : '01', anio = d.mo === 'dic' ? '2026' : '2027';
    return anio + '-' + mes + '-' + String(d.dn).padStart(2, '0');
  };
  const dia = v.dias.find(d => d.id === S.dia) || v.dias[0];
  const sel = h('nav', { class: 'days', 'aria-label': 'Días del viaje' }, v.dias.map(d =>
    h('a', { class: 'day' + (d.nye ? ' nye' : ''), href: '#' + d.id, 'aria-current': d.id === dia.id ? 'true' : 'false' },
      fechaDe(d) === hoy ? h('span', { class: 'today' }, 'Hoy') : null,
      h('span', { class: 'wd' }, d.wd), h('span', { class: 'dn' }, d.dn), h('span', { class: 'mo' }, d.mo))));
  const votable = s => !!(s.map || (s.meal && s.price));
  const tl = h('ol', { class: 'tl' }, dia.stops.map(s => h('li', { class: 'stop' + (s.meal ? ' meal' : '') },
    h('div', { class: 'time' }, s.t),
    h('div', { class: 'body' },
      h('h3', null, s.h),
      s.p ? h('p', null, s.p) : null,
      s.price ? h('p', { class: 'price' }, s.price) : null,
      chipEls(s.chips),
      (s.map || s.tel) ? h('div', { class: 'links' },
        s.map ? h('a', { href: mapa(s.map), target: '_blank', rel: 'noopener' }, 'Ver en el mapa') : null,
        s.tel ? h('a', { href: telHref(s.tel) }, 'Llamar ', h('span', { class: 'tel' }, s.tel)) : null) : null,
      votable(s) ? votos(s.id) : null))));
  return h('section', null, sel,
    h('h2', null, dia.title),
    h('p', { class: 'theme' }, dia.theme),
    dia.alert ? h('p', { class: 'alert' }, h('b', null, 'Atención. '), dia.alert) : null,
    tl,
    dia.nye ? bloqueNochevieja() : null);
}

function bloqueNochevieja(){
  const n = S.viaje.nochevieja;
  return h('div', { class: 'nye-block', id: 'nochevieja' },
    h('h2', null, 'Cena de Nochevieja: opciones'),
    h('p', { class: 'theme' }, n.intro),
    n.opciones.map(o => h('div', { class: 'option' + (o.recomendada ? ' rec' : '') },
      o.recomendada ? h('div', { class: 'tag' }, 'Recomendada') : null,
      h('div', { class: 'nrow' }, h('h3', null, o.nombre), h('span', { class: 'pr' }, o.precio)),
      h('p', null, o.desc),
      o.contactos ? h('div', { class: 'links' }, o.contactos.map(c =>
        h('a', { href: telHref(c.tel) }, c.n + ' ', h('span', { class: 'tel' }, c.tel)))) : null,
      votos(o.id))),
    h('p', { class: 'small', style: 'margin-top:12px' }, n.descartadas));
}

/* ── Vista: reservas ────────────────────────────────────────────────────── */
const ESTADO = { confirmada: 'Confirmada', pendiente: 'Pendiente', porhacer: 'Por hacer' };
function viewReservas(){
  const v = S.viaje;
  const todas = v.reservas.concat(v.entradas);
  const cuenta = k => todas.filter(r => r.estado === k).length;
  const item = r => h('div', { class: 'ritem' },
    h('div', { class: 'when' }, h('b', null, r.dia), r.hora || ''),
    h('div', { style: 'min-width:0' },
      h('div', { class: 'top-row' }, h('h3', null, r.que), h('span', { class: 'pill ' + r.estado }, ESTADO[r.estado])),
      r.detalle ? h('p', null, r.detalle) : null,
      (r.tel || r.url) ? h('div', { class: 'links' },
        r.tel ? h('a', { href: telHref(r.tel) }, 'Llamar ', h('span', { class: 'tel' }, r.tel)) : null,
        r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Web de entradas') : null,
        r.que === 'Cena de Nochevieja' ? h('a', { href: '#nochevieja' }, 'Ver opciones') : null) : null));
  return h('section', null,
    h('h2', null, 'Reservas y entradas'),
    h('p', { class: 'lead' }, 'Qué está cerrado y qué falta. Lo actualiza Gerardo.'),
    h('div', { class: 'status-sum' }, ['confirmada', 'pendiente', 'porhacer'].map(k =>
      h('span', { class: 'pill ' + k }, cuenta(k) + ' ' + ESTADO[k].toLowerCase()))),
    h('div', { class: 'sub-h' }, 'Comidas y cenas'),
    h('div', { class: 'rlist' }, v.reservas.map(item)),
    h('div', { class: 'sub-h' }, 'Entradas'),
    h('div', { class: 'rlist' }, v.entradas.map(item)));
}

/* ── Vista: comer ───────────────────────────────────────────────────────── */
function viewComer(){
  return h('section', null,
    h('h2', null, 'Dónde comer'),
    h('p', { class: 'lead' }, 'Somos grupo grande: reservad siempre y pedid mesa larga. Precios orientativos por adulto, sin bebida. Votad los que os apetezcan.'),
    h('div', { class: 'tip' }, h('b', null, 'Truco de guía: '), 'en diciembre la sardina no está en temporada, así que en el espeto pedid dorada o gambón. Y probad boquerones al limón, conchas finas, coquinas y la ensaladilla malagueña.'),
    S.viaje.comer.map(g => h('div', { class: 'group' }, h('h3', null, g.grupo),
      h('div', { class: 'cards' }, g.sitios.map(r => h('div', { class: 'card' },
        h('div', { class: 'zone' }, r.zona),
        h('div', { class: 'nrow' }, h('h3', null, r.nombre), h('span', { class: 'pr' }, r.precio)),
        h('p', null, r.desc),
        h('div', { class: 'links' },
          h('a', { href: mapa(r.mapa), target: '_blank', rel: 'noopener' }, 'Ver en el mapa'),
          r.tel ? h('a', { href: telHref(r.tel) }, 'Llamar ', h('span', { class: 'tel' }, r.tel)) : null),
        votos(r.id)))))));
}

/* ── Acceso ─────────────────────────────────────────────────────────────── */
function avisoSinBackend(){
  return h('div', { class: 'notice' }, h('h3', null, 'Muy pronto'),
    'Esta parte se activa cuando conectemos la base de datos compartida. El plan, las reservas y los sitios ya funcionan.');
}
function avisoEntrar(que){
  return h('div', { class: 'notice' }, h('h3', null, 'Entra con la clave familiar'),
    h('p', { style: 'margin:4px 0 12px' }, 'Para ver y apuntar ' + que + ' necesitas la clave que ha repartido Gerardo.'),
    h('button', { class: 'btn sea', type: 'button', onclick: () => abrirEntrada(S.clave ? 2 : 1) }, 'Entrar'));
}

function cerrarHoja(){ const s = document.getElementById('sheet'); s.hidden = true; s.replaceChildren(); }
function abrirEntrada(paso){
  const sheet = document.getElementById('sheet');
  const pintar = (paso, err) => {
    const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sh-t' });
    if (paso === 1){
      const inp = h('input', { type: 'password', id: 'clave', autocomplete: 'current-password', placeholder: 'Clave familiar' });
      const f = h('form', { class: 'form', onsubmit: async e => {
        e.preventDefault();
        const val = inp.value.trim(); if (!val) return;
        btn.disabled = true;
        let ok = false;
        try{ ok = await rpc('comprobar_clave', { p_clave: val }); }
        catch{ pintar(1, 'No hay conexión. Prueba otra vez en un momento.'); return; }
        if (!ok){ pintar(1, 'Esa clave no es correcta.'); return; }
        S.clave = val; store.set('clave', val);
        await sync();
        pintar(2);
      } });
      const btn = h('button', { class: 'btn sea', type: 'submit' }, 'Continuar');
      f.append(h('label', { class: 'f', for: 'clave' }, 'Clave familiar', inp), err ? h('p', { class: 'err' }, err) : null,
        h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: cerrarHoja }, 'Cancelar'), btn));
      box.append(h('h2', { id: 'sh-t' }, 'Entrar'),
        h('p', { class: 'lead' }, 'Con la clave familiar podrás votar planes, repartir tareas y apuntar gastos.'), f);
      sheet.replaceChildren(box); sheet.hidden = false; setTimeout(() => inp.focus(), 50);
      return;
    }
    // Paso 2: quién eres
    const nuevo = h('input', { type: 'text', id: 'nuevo-nombre', maxlength: '40', placeholder: 'Por ejemplo: Gerardo y Ana', autocomplete: 'name' });
    const elegir = p => { S.yo = { id: p.id, nombre: p.nombre }; store.set('yo', S.yo); cerrarHoja(); render(); toast('Hola, ' + p.nombre); };
    const f = h('form', { class: 'form', onsubmit: async e => {
      e.preventDefault();
      const n = nuevo.value.trim(); if (!n) return;
      add.disabled = true;
      try{
        const id = await rpc('alta_persona', { p_clave: S.clave, p_nombre: n });
        await sync(); elegir({ id, nombre: n });
      }catch{ pintar(2, 'No se ha podido guardar. Prueba otra vez.'); }
    } });
    const add = h('button', { class: 'btn sea', type: 'submit' }, 'Añadir');
    f.append(h('label', { class: 'f', for: 'nuevo-nombre' }, 'No estoy en la lista', h('div', { class: 'row' }, nuevo, add)),
      h('p', { class: 'small', style: 'margin:0' }, 'Si pagáis en pareja, apuntaos juntos: así los gastos se reparten por pareja.'),
      err ? h('p', { class: 'err' }, err) : null);
    box.append(h('h2', { id: 'sh-t' }, '¿Quién eres?'),
      personas().length ? h('div', { class: 'people' }, personas().map(p =>
        h('button', { type: 'button', 'aria-pressed': String(!!(S.yo && S.yo.id === p.id)), onclick: () => elegir(p) }, p.nombre))) : null,
      f,
      h('div', { class: 'actions' },
        h('button', { class: 'btn link', type: 'button', onclick: () => {
          S.clave = null; S.yo = null; S.datos = null; store.del('clave'); store.del('yo'); cerrarHoja(); render();
        } }, 'Salir de este móvil'),
        h('button', { class: 'btn ghost', type: 'button', onclick: cerrarHoja }, 'Cerrar')));
    sheet.replaceChildren(box); sheet.hidden = false;
  };
  if (!BACKEND) return;
  pintar(paso === 2 && S.clave ? 2 : 1);
}

/* ── Vista: tareas ──────────────────────────────────────────────────────── */
function botonBorrar(key, onYes){
  if (S.confirmar === key){
    return h('div', { class: 'confirm' }, '¿Borrar?',
      h('button', { class: 'btn danger', type: 'button', style: 'padding:5px 10px', onclick: () => { S.confirmar = null; onYes(); } }, 'Sí, borrar'),
      h('button', { class: 'btn ghost', type: 'button', style: 'padding:5px 10px', onclick: () => { S.confirmar = null; render(); } }, 'No'));
  }
  return h('button', { class: 'btn link', type: 'button', onclick: () => { S.confirmar = key; render(); } }, 'Borrar');
}
function selectPersona(id, value, onchange, vacio){
  return h('select', { id, onchange: e => onchange(e.target.value) },
    h('option', { value: '' }, vacio),
    personas().map(p => h('option', { value: p.id, selected: p.id === value ? true : null }, p.nombre)));
}
function viewTareas(){
  const sec = h('section', null, h('h2', null, 'Tareas y compras'),
    h('p', { class: 'lead' }, 'Lo que hay que hacer antes y durante el viaje. Cualquiera puede añadir, apuntarse y marcar como hecho.'));
  if (!BACKEND){ sec.append(avisoSinBackend()); return sec; }
  if (!S.clave || !S.datos){ sec.append(avisoEntrar('las tareas')); return sec; }
  const dias = ['', ...S.viaje.dias.map(d => d.wd + ' ' + d.dn)];
  const d = S.draftTarea;
  const tit = h('input', { type: 'text', id: 'nueva-tarea', maxlength: '120', placeholder: 'Por ejemplo: comprar el cava', value: d.titulo,
    oninput: e => { d.titulo = e.target.value; } });
  const dia = h('select', { id: 'nueva-tarea-dia', onchange: e => { d.dia = e.target.value; } },
    dias.map(x => h('option', { value: x, selected: x === d.dia ? true : null }, x || 'Sin día')));
  sec.append(h('form', { class: 'panel form', onsubmit: async e => {
    e.preventDefault();
    if (!d.titulo.trim()) return;
    if (await act('crear_tarea', { p_titulo: d.titulo.trim(), p_dia: d.dia, p_responsable: null }, 'Tarea añadida')){
      S.draftTarea = { titulo: '', dia: '' }; render();
    }
  } }, h('h3', null, 'Añadir tarea'),
    h('div', { class: 'row' }, h('label', { class: 'f', for: 'nueva-tarea' }, 'Qué hay que hacer', tit), h('label', { class: 'f', for: 'nueva-tarea-dia' }, 'Para qué día', dia)),
    h('div', null, h('button', { class: 'btn sea', type: 'submit', disabled: S.busy || null }, 'Añadir'))));

  const fila = t => h('li', { class: 'task' + (t.hecha ? ' done' : '') },
    h('input', { type: 'checkbox', id: 'tk-' + t.id, checked: t.hecha, disabled: S.busy || null, 'aria-label': 'Hecha',
      onchange: e => act('actualizar_tarea', { p_id: t.id, p_hecha: e.target.checked, p_responsable: t.responsable }, e.target.checked ? 'Hecho' : null) }),
    h('div', { style: 'min-width:0' },
      h('label', { class: 't', for: 'tk-' + t.id }, t.titulo),
      h('div', { class: 'meta' },
        t.dia ? h('span', { class: 'chip' }, t.dia) : null,
        selectPersona('rs-' + t.id, t.responsable, val => act('actualizar_tarea', { p_id: t.id, p_hecha: t.hecha, p_responsable: val || null }), 'Sin responsable'),
        S.yo && t.responsable !== S.yo.id && !t.hecha ? h('button', { class: 'btn link', type: 'button',
          onclick: () => act('actualizar_tarea', { p_id: t.id, p_hecha: t.hecha, p_responsable: S.yo.id }, 'Te la has apuntado') }, 'Me encargo yo') : null)),
    botonBorrar('t' + t.id, () => act('borrar_tarea', { p_id: t.id }, 'Tarea borrada')));
  const pend = S.datos.tareas.filter(t => !t.hecha), hechas = S.datos.tareas.filter(t => t.hecha);
  sec.append(h('div', { class: 'sub-h' }, 'Pendientes · ' + pend.length),
    pend.length ? h('ul', { class: 'tasks' }, pend.map(fila)) : h('p', { class: 'small' }, 'No queda nada pendiente.'));
  if (hechas.length) sec.append(h('div', { class: 'sub-h' }, 'Hechas · ' + hechas.length), h('ul', { class: 'tasks' }, hechas.map(fila)));
  return sec;
}

/* ── Vista: gastos ──────────────────────────────────────────────────────── */
function cuentas(gastos){
  const saldo = new Map(), pagado = new Map(), debe = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  let total = 0;
  for (const g of gastos){
    const c = Math.round(Number(g.importe) * 100);
    total += c;
    add(pagado, g.pagador, c); add(saldo, g.pagador, c);
    const n = g.reparto.length, base = Math.floor(c / n);
    let resto = c - base * n;
    g.reparto.forEach(p => { const parte = base + (resto-- > 0 ? 1 : 0); add(debe, p, parte); add(saldo, p, -parte); });
  }
  const deudores = [], acreedores = [];
  for (const [p, s] of saldo){ if (s < 0) deudores.push([p, -s]); else if (s > 0) acreedores.push([p, s]); }
  deudores.sort((a, b) => b[1] - a[1]); acreedores.sort((a, b) => b[1] - a[1]);
  const pagos = [];
  let i = 0, j = 0;
  while (i < deudores.length && j < acreedores.length){
    const m = Math.min(deudores[i][1], acreedores[j][1]);
    if (m > 0) pagos.push({ de: deudores[i][0], a: acreedores[j][0], c: m });
    deudores[i][1] -= m; acreedores[j][1] -= m;
    if (!deudores[i][1]) i++;
    if (!acreedores[j][1]) j++;
  }
  return { total, saldo, pagado, debe, pagos };
}
function viewGastos(){
  const sec = h('section', null, h('h2', null, 'Gastos compartidos'),
    h('p', { class: 'lead' }, 'Apuntad lo que pague cada uno y la app calcula cómo quedar en paz al final.'));
  if (!BACKEND){ sec.append(avisoSinBackend()); return sec; }
  if (!S.clave || !S.datos){ sec.append(avisoEntrar('los gastos')); return sec; }
  const ps = personas();
  if (!ps.length){ sec.append(h('div', { class: 'notice' }, 'Todavía no hay nadie apuntado. Pulsa tu nombre arriba para añadirte.')); return sec; }

  const gastos = S.datos.gastos;
  const c = cuentas(gastos);
  if (gastos.length){
    const resumen = h('div', { class: 'panel' },
      h('div', { class: 'kpi' }, h('span', { class: 'big' }, fmt(c.total)), h('span', { class: 'small' }, 'gastado entre todos · ' + gastos.length + (gastos.length === 1 ? ' gasto' : ' gastos'))),
      h('ul', { class: 'balances' }, ps.filter(p => c.pagado.has(p.id) || c.debe.has(p.id)).map(p => {
        const s = c.saldo.get(p.id) || 0;
        return h('li', null, h('span', { class: 'nm' }, p.nombre),
          h('span', { class: 'money ' + (s > 0 ? 'pos' : s < 0 ? 'neg' : '') }, (s > 0 ? '+' : '') + fmt(s)),
          h('span', { class: 'sm' }, 'Ha pagado ' + fmt(c.pagado.get(p.id) || 0) + ' · le toca ' + fmt(c.debe.get(p.id) || 0)));
      })));
    sec.append(resumen);
    sec.append(h('div', { class: 'sub-h' }, 'Para quedar en paz'),
      c.pagos.length ? h('ul', { class: 'settle' }, c.pagos.map(x => h('li', null, h('b', null, nombre(x.de)), ' paga ', h('b', { class: 'money' }, fmt(x.c)), ' a ', h('b', null, nombre(x.a)))))
        : h('p', { class: 'small' }, 'Estáis en paz.'));
  }

  if (!S.draftGasto) S.draftGasto = { concepto: '', importe: '', pagador: S.yo ? S.yo.id : '', reparto: ps.map(p => p.id), fecha: hoyISO() };
  const d = S.draftGasto;
  d.reparto = d.reparto.filter(id => ps.some(p => p.id === id));
  const err = h('p', { class: 'err', hidden: true });
  const form = h('form', { class: 'panel form', style: 'margin-top:16px', onsubmit: async e => {
    e.preventDefault();
    const imp = Number(String(d.importe).replace(/\s/g, '').replace(',', '.'));
    if (!d.concepto.trim() || !(imp > 0) || !d.pagador || !d.reparto.length){
      err.textContent = 'Rellena qué es, el importe, quién pagó y entre quién se reparte.'; err.hidden = false; return;
    }
    if (await act('crear_gasto', { p_concepto: d.concepto.trim(), p_importe: Math.round(imp * 100) / 100, p_pagador: d.pagador, p_reparto: d.reparto, p_fecha: d.fecha || null }, 'Gasto apuntado')){
      S.draftGasto = null; render();
    }
  } },
    h('h3', null, 'Apuntar gasto'),
    h('div', { class: 'row' },
      h('label', { class: 'f', for: 'g-concepto' }, 'Qué es', h('input', { type: 'text', id: 'g-concepto', maxlength: '80', placeholder: 'Por ejemplo: compra del súper', value: d.concepto, oninput: e => { d.concepto = e.target.value; } })),
      h('label', { class: 'f', for: 'g-importe' }, 'Importe (€)', h('input', { type: 'text', inputmode: 'decimal', id: 'g-importe', placeholder: '0,00', value: d.importe, oninput: e => { d.importe = e.target.value; } }))),
    h('div', { class: 'row' },
      h('label', { class: 'f', for: 'g-pagador' }, 'Pagó', selectPersona('g-pagador', d.pagador, v => { d.pagador = v; }, 'Elige quién')),
      h('label', { class: 'f', for: 'g-fecha' }, 'Fecha', h('input', { type: 'date', id: 'g-fecha', value: d.fecha, oninput: e => { d.fecha = e.target.value; } }))),
    h('fieldset', { style: 'border:0;padding:0;margin:0;min-width:0' },
      h('legend', { class: 'f', style: 'font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px' }, 'Entre quién se reparte'),
      h('div', { class: 'checks' }, ps.map(p => h('label', null,
        h('input', { type: 'checkbox', id: 'g-r-' + p.id, checked: d.reparto.includes(p.id), onchange: e => {
          d.reparto = e.target.checked ? [...new Set([...d.reparto, p.id])] : d.reparto.filter(x => x !== p.id);
        } }), p.nombre)))),
    err,
    h('div', null, h('button', { class: 'btn sea', type: 'submit', disabled: S.busy || null }, 'Apuntar')));
  sec.append(form);

  if (gastos.length){
    sec.append(h('div', { class: 'sub-h' }, 'Todos los gastos'),
      h('ul', { class: 'glist' }, gastos.map(g => h('li', { class: 'gitem' },
        h('span', { class: 'c' }, g.concepto),
        h('span', { class: 's' }, new Date(g.fecha + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ' · pagó ' + nombre(g.pagador) + ' · entre ' + g.reparto.length),
        h('span', { class: 'a' }, h('span', { class: 'money' }, fmt(Math.round(Number(g.importe) * 100))),
          botonBorrar('g' + g.id, () => act('borrar_gasto', { p_id: g.id }, 'Gasto borrado')))))));
  }
  return sec;
}

/* ── Vista: info ────────────────────────────────────────────────────────── */
function viewInfo(){
  const p = S.viaje.practico;
  const celda = v => { const m = /^([xh]):(.*)$/.exec(v); return m ? h('td', { class: m[1] }, m[2]) : h('td', { class: 'o' }, v); };
  const instalar = S.installPrompt
    ? h('button', { class: 'btn sea', type: 'button', onclick: async () => { S.installPrompt.prompt(); S.installPrompt = null; render(); } }, 'Instalar la app')
    : h('p', null, 'iPhone: abre la web en Safari, pulsa Compartir y luego «Añadir a pantalla de inicio». Android: menú de Chrome y «Instalar aplicación».');
  const compartir = h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
    const url = location.origin + location.pathname;
    try{
      if (navigator.share) await navigator.share({ title: 'Málaga en familia', text: 'Plan del viaje a Málaga', url });
      else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
    }catch{}
  } }, 'Compartir el enlace');
  return h('section', null,
    h('h2', null, 'Información práctica'),
    h('p', { class: 'lead' }, S.viaje.grupo + '. Desayunos en casa, comidas fuera.'),
    h('div', { class: 'cards' },
      h('div', { class: 'card' }, h('div', { class: 'zone' }, 'La casa'), h('h3', null, p.casa.titulo), h('p', null, p.casa.detalle),
        h('div', { class: 'links' }, h('a', { href: mapa(p.casa.mapa), target: '_blank', rel: 'noopener' }, 'Ver en el mapa'))),
      h('div', { class: 'card' }, h('div', { class: 'zone' }, 'En el móvil'), h('h3', null, 'Tenla como una app'), instalar,
        h('div', { style: 'margin-top:10px' }, compartir))),
    h('div', { class: 'group' }, h('h3', null, 'Horarios de estos días'),
      h('div', { class: 'tblwrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Lugar'), p.horarios.cols.map(c => h('th', null, c)))),
        h('tbody', null, p.horarios.filas.map(f => h('tr', null, h('td', null, f[0]), f.slice(1).map(celda)))))),
      h('p', { class: 'small' }, p.horarios.nota)),
    h('div', { class: 'group' }, h('h3', null, 'Consejos'),
      h('div', { class: 'cards' }, p.tarjetas.map(t => h('div', { class: 'card' }, h('div', { class: 'zone' }, t.zona), h('h3', null, t.titulo), h('p', null, t.texto))))),
    h('footer', { class: 'foot' }, 'Plan actualizado el ' + new Date(S.viaje.actualizado + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) + '. Confirmad horarios unos días antes del viaje.'));
}

/* ── Render y rutas ─────────────────────────────────────────────────────── */
const VIEWS = { plan: viewPlan, reservas: viewReservas, comer: viewComer, tareas: viewTareas, gastos: viewGastos, info: viewInfo };
function render(){
  if (!S.viaje) return;
  renderHeader(); renderBanner(); renderTabs();
  const main = document.getElementById('main');
  main.replaceChildren(VIEWS[S.view]());
}

function diaPorDefecto(){
  const hoy = hoyISO();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hoy);
  const id = 'dia-' + Number(m[3]);
  if ((m[1] === '2026' && m[2] === '12') || (m[1] === '2027' && m[2] === '01')) {
    if (S.viaje.dias.some(d => d.id === id)) return id;
  }
  return store.get('dia') || S.viaje.dias[0].id;
}
function route(){
  const hsh = location.hash.slice(1);
  const prev = S.view + (S.dia || '');
  let scrollTo = null;
  if (S.viaje.dias.some(d => d.id === hsh)){ S.view = 'plan'; S.dia = hsh; store.set('dia', hsh); }
  else if (hsh === 'nochevieja'){ S.view = 'plan'; S.dia = 'dia-31'; scrollTo = 'nochevieja'; }
  else if (VIEWS[hsh]) S.view = hsh;
  else { S.view = 'plan'; }
  if (!S.dia) S.dia = diaPorDefecto();
  S.confirmar = null;
  render();
  if (scrollTo){ const el = document.getElementById(scrollTo); if (el) el.scrollIntoView({ block: 'start' }); }
  else if (prev !== S.view + (S.dia || '')) window.scrollTo(0, 0);
}

async function init(){
  try{
    const r = await fetch('data/viaje.json', { cache: 'no-cache' });
    S.viaje = await r.json();
  }catch{
    document.getElementById('main').replaceChildren(h('p', { class: 'loading' }, 'No se ha podido cargar el plan. Revisa la conexión y vuelve a abrir la app.'));
    return;
  }
  window.addEventListener('hashchange', route);
  cuentaAtras(); setInterval(cuentaAtras, 1000);
  route();
  if (BACKEND && S.clave) sync();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync({ quiet: true }); });
  setInterval(() => { if (document.visibilityState === 'visible') sync({ quiet: true }); }, 45000);
  document.getElementById('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') cerrarHoja(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('sheet').hidden) cerrarHoja(); });
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installPrompt = e; if (S.view === 'info') render(); });
if ('serviceWorker' in navigator && location.protocol === 'https:'){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
init();
