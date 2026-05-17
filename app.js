// Timebase — web app
// Vanilla JS, no framework, no deps. State + scrub + OKLCH render.

const STORAGE_KEY = 'timebase.v1';
const PX_PER_MIN = 0.5;          // 1 minute per 0.5px of pan delta; ~10s per pixel
const HOUR_SPAN = 24;
const SCRUB_BOUND_MIN = 2 * 24 * 60;  // ±2 days

function clampScrub(v) {
  if (v > SCRUB_BOUND_MIN) return SCRUB_BOUND_MIN;
  if (v < -SCRUB_BOUND_MIN) return -SCRUB_BOUND_MIN;
  return v;
}

/* ───────────── palette ───────────── */

// Night = calm and rested (muted, cool). Day = bright and alive (warm
// peach/honey/amber, high luminance, moderate chroma — never neon).
const PALETTE_LIGHT = [
  [0,    '#1E2538'],
  [3,    '#2A3548'],
  [5.5,  '#6A5F78'],
  [6.5,  '#F2DBA8'],
  [8,    '#F8E5BC'],
  [10,   '#F8D89E'],
  [12,   '#F8C788'],
  [14,   '#ECB070'],
  [16,   '#D89255'],
  [18,   '#C56E48'],
  [19.5, '#A55048'],
  [21,   '#5A4960'],
  [23,   '#2A3550'],
  [24,   '#1E2538'],
];
const PALETTE_DARK = [
  [0,    '#0F1322'],
  [3,    '#171F30'],
  [5.5,  '#423D52'],
  [6.5,  '#A8916A'],
  [8,    '#B5A076'],
  [10,   '#B59866'],
  [12,   '#B58A58'],
  [14,   '#A87648'],
  [16,   '#996038'],
  [18,   '#884A30'],
  [19.5, '#703230'],
  [21,   '#382E3A'],
  [23,   '#171F30'],
  [24,   '#0F1322'],
];

/* ───────────── color math ───────────── */
// sRGB hex → OKLCH (perceptually uniform).

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function rgbToOklab([r, g, b]) {
  r = srgbToLinear(r); g = srgbToLinear(g); b = srgbToLinear(b);
  const l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b;
  const m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b;
  const s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
    1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
    0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_,
  ];
}
function oklabToOklch([L, a, b]) {
  return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}
function hexToOklch(hex) { return oklabToOklch(rgbToOklab(hexToRgb(hex))); }

// Pre-compute OKLCH for each anchor.
function precompute(palette) {
  return palette.map(([h, hex]) => ({ hour: h, lch: hexToOklch(hex) }));
}
const ANCHORS = { light: precompute(PALETTE_LIGHT), dark: precompute(PALETTE_DARK) };

// Hue lerp around the short arc.
function lerpHue(h1, h2, t) {
  let d = h2 - h1;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (h1 + d * t + 360) % 360;
}
function interpolate(palette, hour) {
  hour = ((hour % HOUR_SPAN) + HOUR_SPAN) % HOUR_SPAN;
  for (let i = 0; i < palette.length - 1; i++) {
    const a = palette[i], b = palette[i + 1];
    if (hour >= a.hour && hour <= b.hour) {
      const t = (hour - a.hour) / (b.hour - a.hour);
      const [L1, C1, H1] = a.lch, [L2, C2, H2] = b.lch;
      return [
        L1 + (L2 - L1) * t,
        C1 + (C2 - C1) * t,
        lerpHue(H1, H2, t),
      ];
    }
  }
  return palette[0].lch;
}
function lchToCssColor([L, C, H]) {
  return `oklch(${(L*100).toFixed(2)}% ${C.toFixed(4)} ${H.toFixed(2)})`;
}
function contrastForeground([L]) {
  // L is 0..1 in OKLab. ~0.65 is the crossover for legible white-on-color.
  return L < 0.62 ? '#FFFFFF' : '#0E0E10';
}

/* ───────────── time helpers ───────────── */

function nowMs() { return Date.now() + store.scrubOffsetMin * 60_000; }

function formatTime(ms, tz) {
  const opts = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: store.settings.h24 === 'system' ? undefined : store.settings.h24 === 'off',
    timeZone: tz,
  };
  return new Intl.DateTimeFormat('en-US', opts).format(ms);
}
function formatHourFraction(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: tz,
  }).formatToParts(ms);
  const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return h + m / 60;
}
function dayKey(ms, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ms); // YYYY-MM-DD
}
function tzAbbr(ms, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms);
    return p.find(x => x.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
}
function tzOffset(ms, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(ms);
    return p.find(x => x.type === 'timeZoneName')?.value.replace('GMT', 'UTC') || '';
  } catch { return ''; }
}

/* ───────────── distance & sunrise ───────────── */

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(a)));
}

// Simplified NOAA solar calculation (accuracy ~1-2 min).
function sunTimes(date, lat, lon) {
  const J1970 = 2440588, J2000 = 2451545;
  const dayMs = 86400000;
  const toJulian = d => d / dayMs - 0.5 + J1970;
  const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
  const rad = Math.PI / 180;
  const e = rad * 23.4397;
  const d = toJulian(date.getTime()) - J2000;
  const n = Math.round(d - 0.0009 + lon / 360);
  const ds = 0.0009 - lon / 360 + n;
  const M = rad * ((357.5291 + 0.98560028 * ds) % 360);
  const L = (M / rad + 1.9148 * Math.sin(M) + 0.0200 * Math.sin(2*M) + 0.0003 * Math.sin(3*M) + 102.9372 + 180) % 360 * rad;
  const dec = Math.asin(Math.sin(L) * Math.sin(e));
  const H = Math.acos((Math.sin(-0.83 * rad) - Math.sin(lat*rad) * Math.sin(dec)) / (Math.cos(lat*rad) * Math.cos(dec)));
  if (isNaN(H)) return { sunrise: null, sunset: null };
  const Jset = J2000 + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2*L) + (H/(2*Math.PI)) + ds;
  const Jrise = J2000 + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2*L) - (H/(2*Math.PI)) + ds;
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

/* ───────────── store ───────────── */

const store = {
  cities: [],
  homeId: null,
  scrubOffsetMin: 0,
  settings: { h24: 'system', appearance: 'system' },
  hintSeen: false,
};

let CITY_DB = [];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      Object.assign(store, s);
    }
  } catch {}
}
function saveState() {
  const { cities, homeId, settings, hintSeen } = store;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ cities, homeId, settings, hintSeen }));
}

async function loadCityDB() {
  try {
    const res = await fetch('/cities.json');
    CITY_DB = await res.json();
  } catch (e) {
    console.error('Failed to load cities.json', e);
    CITY_DB = [];
  }
}

function ensureDefaults() {
  if (store.cities.length === 0) {
    const guessTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const guessed = CITY_DB.find(c => c.tz === guessTz) ||
                    CITY_DB.find(c => c.name === 'San Francisco');
    const seeds = [guessed, ...['New York', 'London', 'Tokyo'].map(n => CITY_DB.find(c => c.name === n))]
      .filter(Boolean)
      .filter((c, i, arr) => arr.findIndex(x => x.tz === c.tz) === i);
    store.cities = seeds.map(c => ({ ...c, id: cityId(c) }));
    store.homeId = store.cities[0]?.id || null;
    saveState();
  }
}

function cityId(c) { return `${c.name}|${c.tz}`; }

// All cities (including home) sorted by UTC offset ascending — colors flow
// as a continuous gradient. Home is marked with a 🏠 prefix on its row.
function orderedCities() {
  return [...store.cities].sort((a, b) => {
    const aOff = tzOffsetMinutes(a.tz);
    const bOff = tzOffsetMinutes(b.tz);
    if (aOff === bOff) return a.name.localeCompare(b.name);
    return aOff - bOff;
  });
}

function tzOffsetMinutes(tz) {
  // Get current UTC offset in minutes for the given IANA timezone.
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, timeZoneName: 'longOffset',
  });
  const parts = dtf.formatToParts(now);
  const tzn = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+0';
  const m = tzn.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const h = parseInt(m[2], 10);
  const mm = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (h * 60 + mm);
}

/* ───────────── render ───────────── */

const clockEl = document.getElementById('clock');
const scrubPill = document.getElementById('scrub-pill');
const nextPill = document.getElementById('next-pill');

function palette() {
  const mode = currentAppearance();
  return ANCHORS[mode];
}
function currentAppearance() {
  if (store.settings.appearance === 'light') return 'light';
  if (store.settings.appearance === 'dark') return 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  document.documentElement.dataset.theme = store.settings.appearance === 'system' ? '' : store.settings.appearance;
}

function renderClock() {
  applyTheme();
  const ms = nowMs();
  const homeKey = store.homeId ? dayKey(ms, (store.cities.find(c => c.id === store.homeId)?.tz) || 'UTC') : null;
  const pal = palette();

  // Render rows.
  const frag = document.createDocumentFragment();
  for (const city of orderedCities()) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = city.id;

    const h = formatHourFraction(ms, city.tz);
    const lch = interpolate(pal, h);
    const cssBase = lchToCssColor(lch);
    // Two-stop subtle gradient: lighter top, slightly deeper bottom.
    const topLch = [Math.min(1, lch[0] + 0.035), lch[1] * 0.95, lch[2]];
    const botLch = [Math.max(0, lch[0] - 0.025), lch[1], lch[2]];
    row.style.setProperty('--row-bg-top', lchToCssColor(topLch));
    row.style.setProperty('--row-bg-bot', lchToCssColor(botLch));
    row.style.setProperty('--row-bg', cssBase);
    const fg = contrastForeground(lch);
    row.style.setProperty('--row-fg', fg);

    const dKey = dayKey(ms, city.tz);
    let dayChip = '';
    if (homeKey && dKey !== homeKey) {
      const diff = (new Date(dKey) - new Date(homeKey)) / 86400000;
      dayChip = `<span class="day-chip">${diff > 0 ? '+' : ''}${diff}d</span>`;
    }

    const isHome = city.id === store.homeId;
    const displayName = isHome ? `🏠&nbsp;&nbsp;${city.name}` : city.name;
    row.innerHTML = `
      <div class="name">${displayName}</div>
      <div class="time"><span>${formatTime(ms, city.tz)}</span>${dayChip}</div>
    `;
    // Tap handling now lives in onPointerUp so we don't rely on synthetic
    // click events that can be eaten by pointer capture.
    frag.appendChild(row);
  }
  clockEl.replaceChildren(frag);

  // Scrub pill.
  if (store.scrubOffsetMin !== 0) {
    document.body.classList.add('scrubbed');
    scrubPill.textContent = formatDelta(store.scrubOffsetMin);
    scrubPill.hidden = false;
    nextPill.hidden = true;
  } else {
    document.body.classList.remove('scrubbed');
    scrubPill.hidden = true;
  }
}

function formatDelta(minutes) {
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const days = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = Math.round(abs % 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (h) parts.push(`${h}h`);
  if (m && !days) parts.push(`${m}m`);
  return `${sign}${parts.join(' ') || '0m'}`;
}

/* ───────────── scrub gesture ───────────── */

let dragStart = null;
let dragHappened = false;
let initialScrub = 0;
let dragTargetRow = null;

function onPointerDown(e) {
  if (e.target.closest('button, dialog, #menu-popover, #hint, .pill, #menu-trigger')) return;
  dragStart = { x: e.clientX, y: e.clientY };
  initialScrub = store.scrubOffsetMin;
  dragHappened = false;
  dragTargetRow = e.target.closest('.row');
}
function onPointerMove(e) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  const dist = Math.hypot(dx, dy);
  if (!dragHappened && dist > 10) dragHappened = true;
  if (!dragHappened) return;
  // Vertical-only scrub to match iOS — only claim the gesture once vertical
  // motion clearly dominates. Up = advance time, down = rewind.
  if (Math.abs(dy) < Math.abs(dx) * 0.6) return;
  store.scrubOffsetMin = clampScrub(initialScrub + (-dy) * PX_PER_MIN);
  renderClock();
}
function onPointerUp(e) {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  const dist = Math.hypot(dx, dy);
  const wasShortTap = dist < 10 && dragTargetRow;
  dragStart = null;
  // Tap on a row → open detail sheet (reliable, doesn't depend on the
  // click event which can be flaky with pointer capture / event ordering).
  if (wasShortTap) {
    const id = dragTargetRow.dataset.id;
    if (id) openDetailSheet(id);
  }
  dragTargetRow = null;
}

function snapToNow() {
  const start = store.scrubOffsetMin;
  const t0 = performance.now();
  const duration = 320;
  function step(t) {
    const k = Math.min(1, (t - t0) / duration);
    const eased = 1 - Math.pow(1 - k, 3);
    store.scrubOffsetMin = start * (1 - eased);
    renderClock();
    if (k < 1) requestAnimationFrame(step);
    else { store.scrubOffsetMin = 0; renderClock(); }
  }
  requestAnimationFrame(step);
}

clockEl.addEventListener('pointerdown', onPointerDown);
clockEl.addEventListener('pointermove', onPointerMove);
clockEl.addEventListener('pointerup', onPointerUp);
clockEl.addEventListener('pointercancel', onPointerUp);
clockEl.addEventListener('dblclick', snapToNow);
scrubPill.addEventListener('click', snapToNow);

// Mouse wheel / trackpad scroll → scrub. deltaX positive (scroll right) and
// deltaY negative (scroll up) advance time, mirroring the drag convention.
clockEl.addEventListener('wheel', e => {
  // Only intercept when the target isn't inside a dialog/menu.
  if (e.target.closest('dialog, #menu-popover, #hint')) return;
  e.preventDefault();
  // deltaMode: 0 = pixel, 1 = line, 2 = page. Normalize.
  const scale = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 800 : 1);
  // Vertical-only on web too (matches iOS). Scroll up = advance time.
  const projected = -e.deltaY * scale;
  store.scrubOffsetMin = clampScrub(store.scrubOffsetMin + projected * PX_PER_MIN * 2);
  renderClock();
}, { passive: false });

// Keyboard shortcuts.
//   ← / ↓     : rewind 15 min (Shift: 1h, Cmd/Ctrl: 1d)
//   → / ↑     : advance 15 min (Shift: 1h, Cmd/Ctrl: 1d)
//   Esc / Space: snap to now
document.addEventListener('keydown', e => {
  // Don't intercept when an input/textarea is focused.
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  // If a dialog is open, defer Escape to the dialog so it can close.
  if (e.key === 'Escape' && document.querySelector('dialog[open]')) return;

  if ((e.key === 'Escape' || e.key === ' ') && store.scrubOffsetMin !== 0) {
    e.preventDefault();
    snapToNow();
    return;
  }
  let direction = 0;
  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') direction = 1;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') direction = -1;
  if (!direction) return;
  e.preventDefault();
  let minutes = 15;
  if (e.metaKey || e.ctrlKey) minutes = 24 * 60;     // 1 day
  else if (e.shiftKey) minutes = 60;                  // 1 hour
  store.scrubOffsetMin = clampScrub(store.scrubOffsetMin + direction * minutes);
  renderClock();
});

/* ───────────── dock pills + About card ───────────── */

const addPill = document.getElementById('add-pill');
const aboutPill = document.getElementById('about-pill');
const aboutSheet = document.getElementById('about-sheet');
const aboutSetting24h = document.getElementById('about-setting-24h');
const aboutSettingAppearance = document.getElementById('about-setting-appearance');

addPill.addEventListener('click', () => openAddSheet());
aboutPill.addEventListener('click', () => openAboutCard());

function openAboutCard() {
  aboutSetting24h.value = store.settings.h24;
  aboutSettingAppearance.value = store.settings.appearance;
  aboutSheet.showModal();
}

// Click outside any open dialog → close it. (HTML <dialog> doesn't do this
// natively; the click on the backdrop targets the dialog element itself.)
for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', e => {
    if (e.target === dlg) dlg.close();
  });
}

aboutSetting24h.addEventListener('change', () => {
  store.settings.h24 = aboutSetting24h.value;
  saveState();
  renderClock();
});
aboutSettingAppearance.addEventListener('change', () => {
  store.settings.appearance = aboutSettingAppearance.value;
  saveState();
  applyTheme();
  renderClock();
});

// Add city sheet
const addSheet = document.getElementById('add-sheet');
const citySearch = document.getElementById('city-search');
const cityResults = document.getElementById('city-results');
const sectionLabel = document.getElementById('city-section-label');

function openAddSheet() {
  citySearch.value = '';
  populateCityList('');
  addSheet.showModal();
  requestAnimationFrame(() => citySearch.focus());
}
function populateCityList(query) {
  const q = query.trim().toLowerCase();
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let list;
  if (!q) {
    list = CITY_DB.filter(c => c.popular).slice(0, 12);
    sectionLabel.textContent = 'Suggested';
  } else {
    list = CITY_DB
      .filter(c => norm(c.name).includes(q) || norm(c.country).includes(q))
      .slice(0, 50);
    sectionLabel.textContent = list.length ? 'Results' : 'No matches';
  }
  cityResults.replaceChildren(...list.map(c => {
    const li = document.createElement('li');
    const id = cityId(c);
    const inList = store.cities.some(x => x.id === id);
    li.innerHTML = `<span>${c.name}</span><span class="country">${c.country}${inList ? ' · added (tap to remove)' : ''}</span>`;
    li.addEventListener('click', () => {
      if (inList) {
        if (store.cities.length <= 1) {
          alert('Add another city before removing this one.');
          return;
        }
        store.cities = store.cities.filter(x => x.id !== id);
        if (store.homeId === id) store.homeId = store.cities[0].id;
        saveState();
        renderClock();
        populateCityList(citySearch.value);  // refresh list state
      } else {
        store.cities.push({ ...c, id });
        saveState();
        renderClock();
        addSheet.close();
      }
    });
    return li;
  }));
}
citySearch?.addEventListener('input', () => populateCityList(citySearch.value));

// Detail sheet
const detailSheet = document.getElementById('detail-sheet');
const detailBody = document.getElementById('detail-body');
let activeDetailId = null;

function openDetailSheet(id) {
  activeDetailId = id;
  renderDetail();
  detailSheet.showModal();
}
function renderDetail() {
  const c = store.cities.find(x => x.id === activeDetailId);
  if (!c) return;
  const ms = nowMs();
  const h = formatHourFraction(ms, c.tz);
  const time = formatTime(ms, c.tz);
  const offset = tzOffset(ms, c.tz);
  const abbr = tzAbbr(ms, c.tz);
  const home = store.cities.find(x => x.id === store.homeId);
  const homeFact = home && home.id !== c.id ? hourDelta(home, c) : 'This is home';
  const distance = home && home.id !== c.id ? `${haversineKm(home.lat, home.lon, c.lat, c.lon).toLocaleString()} km` : '—';

  // Day-bar gradient (24 stops).
  const pal = palette();
  const stops = [];
  for (let i = 0; i <= 24; i++) {
    stops.push(`${lchToCssColor(interpolate(pal, i))} ${(i/24*100).toFixed(1)}%`);
  }
  const barGradient = `linear-gradient(to right, ${stops.join(', ')})`;
  const nowPct = (h / 24 * 100).toFixed(2);

  // Sunrise / sunset.
  const localNow = new Date(ms);
  const sun = sunTimes(localNow, c.lat, c.lon);
  const sunStr = (d) => d ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: c.tz, hour12: store.settings.h24 !== 'on' }).format(d) : '—';
  let sunrisePct = null, sunsetPct = null;
  if (sun.sunrise) sunrisePct = (formatHourFraction(sun.sunrise.getTime(), c.tz) / 24 * 100).toFixed(2);
  if (sun.sunset) sunsetPct = (formatHourFraction(sun.sunset.getTime(), c.tz) / 24 * 100).toFixed(2);

  detailBody.innerHTML = `
    <h3>${c.name}</h3>
    <p class="country">${c.country}</p>
    <p class="big-time">${time}</p>
    <p class="tz">${abbr ? abbr + '  ·  ' : ''}${offset}</p>
    <div class="daybar" style="background:${barGradient}">
      ${sunrisePct !== null ? `<div class="tick" style="left:${sunrisePct}%"></div>` : ''}
      ${sunsetPct !== null ? `<div class="tick" style="left:${sunsetPct}%"></div>` : ''}
      <div class="sun-now" style="left:${nowPct}%"></div>
    </div>
    <p class="day-meta">
      <span>rises ${sunStr(sun.sunrise)}</span>
      <span>sets ${sunStr(sun.sunset)}</span>
    </p>
    <ul class="facts">
      <li><span class="label">From home</span>${homeFact}</li>
      <li><span class="label">Distance</span>${distance}</li>
    </ul>
  `;
}
function hourDelta(home, c) {
  const ms = nowMs();
  const hh = formatHourFraction(ms, home.tz);
  const ch = formatHourFraction(ms, c.tz);
  let d = ch - hh;
  if (d > 12) d -= 24;
  if (d < -12) d += 24;
  const sign = d > 0 ? '+' : (d < 0 ? '−' : '');
  const abs = Math.abs(d);
  const whole = Math.floor(abs);
  const frac = abs - whole;
  const half = Math.abs(frac - 0.5) < 0.1;
  const quarter = Math.abs(frac - 0.25) < 0.1 || Math.abs(frac - 0.75) < 0.1;
  return `${sign}${whole}${half ? '½' : quarter ? '¾' : ''} hours from ${home.name}`;
}
document.getElementById('make-home-btn').addEventListener('click', () => {
  if (!activeDetailId) return;
  store.homeId = activeDetailId;
  saveState();
  renderClock();
  detailSheet.close();
});
document.getElementById('remove-btn').addEventListener('click', () => {
  if (!activeDetailId) return;
  if (store.cities.length <= 1) { alert('Add another city before removing this one.'); return; }
  store.cities = store.cities.filter(c => c.id !== activeDetailId);
  if (store.homeId === activeDetailId) store.homeId = store.cities[0].id;
  saveState();
  renderClock();
  detailSheet.close();
});

// (Settings live inside the About card — see openAboutCard above.)

// First-run hint
const hint = document.getElementById('hint');
document.getElementById('hint-dismiss').addEventListener('click', () => {
  hint.hidden = true;
  store.hintSeen = true;
  saveState();
});
function maybeShowHint() {
  if (!store.hintSeen) hint.hidden = false;
}

/* ───────────── lifecycle ───────────── */

async function init() {
  loadState();
  await loadCityDB();
  ensureDefaults();
  applyTheme();
  renderClock();
  maybeShowHint();
  setInterval(renderClock, 1000);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderClock());
}

init();
