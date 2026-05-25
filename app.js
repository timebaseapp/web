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
// OKLCH → sRGB, byte-identical to the iOS OKLCH.toRGBA pipeline: Ottosson
// oklab→linear-sRGB matrices, delinearize, clamp per channel. We emit rgb()
// rather than the CSS oklch() function so the web renders the SAME clamped
// sRGB values as iOS — the browser's own oklch() rendering can drift on
// wide-gamut (P3) displays.
function srgbDelinearize(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function lchToCssColor([L, C, H]) {
  const a = C * Math.cos(H * Math.PI / 180);
  const b = C * Math.sin(H * Math.PI / 180);
  const l_ = L + 0.3963377774*a + 0.2158037573*b;
  const m_ = L - 0.1055613458*a - 0.0638541728*b;
  const s_ = L - 0.0894841775*a - 1.2914855480*b;
  const l = l_*l_*l_, m = m_*m_*m_, s = s_*s_*s_;
  const r  =  4.0767416621*l - 3.3077115913*m + 0.2309699292*s;
  const g  = -1.2684380046*l + 2.6097574011*m - 0.3413193965*s;
  const bl = -0.0041960863*l - 0.7034186147*m + 1.7076147010*s;
  const ch = v => Math.round(Math.min(1, Math.max(0, srgbDelinearize(v))) * 255);
  return `rgb(${ch(r)} ${ch(g)} ${ch(bl)})`;
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
  // null = "use all tracked cities" (so newly-added cities auto-include).
  // Array = the subset of city ids the user has chosen to plan with.
  planParticipants: null,
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
  const { cities, homeId, settings, hintSeen, planParticipants } = store;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ cities, homeId, settings, hintSeen, planParticipants }),
  );
}

// Resolved cities for the planner. Default (no saved selection) is just the
// home city — the user explicitly chips-in whoever else they want to plan
// with. Newly-added tracked cities do NOT auto-join the planner.
function planParticipantIds() {
  if (store.planParticipants && store.planParticipants.length > 0) {
    const valid = store.planParticipants.filter(id => findCity(id) != null);
    if (valid.length > 0) return valid;
  }
  if (store.homeId && store.cities.some(c => c.id === store.homeId)) return [store.homeId];
  return store.cities[0] ? [store.cities[0].id] : [];
}
function planParticipantCities() {
  return planParticipantIds().map(findCity).filter(Boolean);
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

/* ───────────── URL state (shareable links) ─────────────
 * Format:
 *   /?c=San+Francisco,New+York,London,Bengaluru   — cities, in order
 *   &h=San+Francisco                              — home city (optional)
 *   &t=2026-05-21T10:00                           — picked meeting time (optional, opens plan sheet)
 *   &anchor=London                                — anchor city for the meeting time (optional, defaults to home)
 *
 * Cities are referenced by name. If a name in the URL isn't in CITY_DB the
 * entry is silently skipped — graceful degradation matters for shared links.
 */
function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const c = params.get('c');
  if (!c) return null;
  const names = c.split(',').map(s => s.trim()).filter(Boolean);
  const cities = names
    .map(n => CITY_DB.find(x => x.name.toLowerCase() === n.toLowerCase()))
    .filter(Boolean)
    .map(x => ({ ...x, id: cityId(x) }));
  if (cities.length === 0) return null;

  const homeName = params.get('h');
  const homeId = homeName
    ? cities.find(x => x.name.toLowerCase() === homeName.toLowerCase())?.id
    : cities[0].id;

  return {
    cities,
    homeId,
    planTime: params.get('t') || null,
    planAnchor: params.get('anchor') || null,
  };
}
function shareUrl({ includeTime = false, cities = store.cities } = {}) {
  const u = new URL(window.location.origin + '/');
  // Use the LIST order, not the sorted order — order is part of the user's intent.
  u.searchParams.set('c', cities.map(c => c.name).join(','));
  const homeInList = cities.find(x => x.id === store.homeId);
  if (homeInList) u.searchParams.set('h', homeInList.name);
  if (includeTime && planState.dateStr && planState.timeStr && planState.anchorId) {
    u.searchParams.set('t', `${planState.dateStr}T${planState.timeStr}`);
    const anchor =
      cities.find(x => x.id === planState.anchorId) ||
      findCity(planState.anchorId);
    if (anchor) u.searchParams.set('anchor', anchor.name);
  }
  // Use unescaped commas for readability — spec allows them in query strings.
  return u.toString().replace(/%2C/g, ',');
}

function cityId(c) { return `${c.name}|${c.tz}`; }

// Resolve a city id from anywhere — the user's tracked list OR the full
// bundled database. Plan participants can be ANY city, not just tracked.
function findCity(id) {
  const tracked = store.cities.find(c => c.id === id);
  if (tracked) return tracked;
  const inDb = CITY_DB.find(c => cityId(c) === id);
  return inDb ? { ...inDb, id } : null;
}

// All cities (including home) sorted by UTC offset ascending — colors flow
// as a continuous gradient. Home is marked with a 🏠 suffix on its row, so
// every city name still starts at the same left edge (matches iOS).
// `atMs` is the instant the offsets are evaluated at: pass the scrubbed or
// planned time so the row order stays correct across a DST boundary, not
// just at real-world "now".
function orderedCities(atMs = Date.now(), cities = store.cities) {
  return [...cities].sort((a, b) => {
    const aOff = tzOffsetMinutes(a.tz, atMs);
    const bOff = tzOffsetMinutes(b.tz, atMs);
    if (aOff === bOff) return a.name.localeCompare(b.name);
    return aOff - bOff;
  });
}

// UTC offset in minutes for an IANA timezone, evaluated at `atMs`. Because
// it reads the offset for that specific instant, it returns the correct
// standard- or daylight-time offset automatically.
function tzOffsetMinutes(tz, atMs = Date.now()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, timeZoneName: 'longOffset',
  });
  const parts = dtf.formatToParts(atMs);
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

  // Render rows. Order by offset AT the scrubbed instant, so the rows
  // re-sort correctly if a scrub crosses a DST boundary.
  const frag = document.createDocumentFragment();
  for (const city of orderedCities(ms)) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = city.id;

    const h = formatHourFraction(ms, city.tz);
    const lch = interpolate(pal, h);
    // While scrubbed, drop chroma to 70% — matches iOS TimeColor's scrubMute
    // (0.5 → c × (1 − 0.5·0.6)), done in OKLCH space rather than via a filter.
    if (store.scrubOffsetMin !== 0) lch[1] *= 0.7;
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
    const displayName = isHome ? `${city.name}&nbsp;&nbsp;🏠` : city.name;
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
  if (e.target.closest('button, dialog, #menu-popover, .pill, #menu-trigger')) return;
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
  if (e.target.closest('dialog, #menu-popover')) return;
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
  if (e.key === 'ArrowUp') direction = 1;
  else if (e.key === 'ArrowDown') direction = -1;
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

const qrTrigger = document.getElementById('qr-trigger');
const qrSheet = document.getElementById('qr-sheet');
if (qrTrigger && qrSheet) {
  qrTrigger.addEventListener('click', () => qrSheet.showModal());
}

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

/* ───────────── Plan a time (scheduler) ───────────── */

const planSheet     = document.getElementById('plan-sheet');
const planPill      = document.getElementById('plan-pill');
const planAnchorEl  = document.getElementById('plan-anchor');
const planResultsEl = document.getElementById('plan-results');
const planWeekendEl = document.getElementById('plan-weekend-note');
const planCopyBtn   = document.getElementById('plan-copy-btn');
const planNowBtn    = document.getElementById('plan-now-btn');

// Sheet state — kept locally so the URL roundtrip can read it.
const planState = {
  dateStr: '',         // 'YYYY-MM-DD'
  timeStr: '',         // 'HH:MM' (24h, in anchor's tz)
  anchorId: null,
};

function openPlanSheet(opts) {
  // Drop any participants whose city no longer exists in the bundled
  // database (extremely rare — would require cities.json to change).
  if (store.planParticipants) {
    const valid = store.planParticipants.filter(id => findCity(id) != null);
    store.planParticipants = valid.length > 0 ? valid : null;
  }

  rebuildAnchorOptions();
  if (opts && opts.fromUrl && opts.timeStr) {
    // URL provided a time — split it.
    const [d, t] = opts.timeStr.split('T');
    planState.dateStr = d;
    planState.timeStr = (t || '').slice(0, 5);
    if (opts.anchorName) {
      const a = store.cities.find(x => x.name.toLowerCase() === opts.anchorName.toLowerCase());
      if (a) planState.anchorId = a.id;
    }
  }
  // Anchor must be one of the participants; otherwise prefer home, else first.
  const parts = planParticipantCities();
  if (!parts.some(c => c.id === planState.anchorId)) {
    planState.anchorId = parts.some(c => c.id === store.homeId)
      ? store.homeId
      : parts[0]?.id;
  }
  if (!planState.dateStr || !planState.timeStr) seedDefaultTime();

  refreshPlanFields();
  renderPlanChips();
  renderPlanResults();
  planSheet.showModal();
}

const planChipsEl = document.getElementById('plan-chips');

function renderPlanChips() {
  const ids = planParticipantIds();
  const canRemove = ids.length > 1;
  const chips = ids.map(id => {
    const c = findCity(id);
    if (!c) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'plan-chip';
    const homeMark = c.id === store.homeId ? ' 🏠' : '';
    b.innerHTML = `<span>${c.name}${homeMark}</span><span class="plan-chip-x" aria-hidden="true">×</span>`;
    b.setAttribute('aria-label', `Remove ${c.name}`);
    if (canRemove) {
      b.addEventListener('click', () => removePlanParticipant(c.id));
    } else {
      b.disabled = true;
      b.title = 'At least one participant';
    }
    return b;
  }).filter(Boolean);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'plan-chip plan-chip-add';
  addBtn.textContent = '+ Add city';
  addBtn.addEventListener('click', openPlanPickerSheet);

  planChipsEl.replaceChildren(...chips, addBtn);
}

function addPlanParticipant(id) {
  const ids = planParticipantIds();
  if (ids.includes(id)) return;
  store.planParticipants = [...ids, id];
  saveState();
  rebuildAnchorOptions();
  renderPlanChips();
  renderPlanResults();
}

function removePlanParticipant(id) {
  const ids = planParticipantIds();
  if (!ids.includes(id) || ids.length <= 1) return;
  const updated = ids.filter(i => i !== id);
  store.planParticipants = updated;
  saveState();
  // If we just removed the anchor, fall back to home (if present) or first.
  if (planState.anchorId === id) {
    planState.anchorId = updated.includes(store.homeId) ? store.homeId : updated[0];
  }
  rebuildAnchorOptions();
  refreshPlanFields();
  renderPlanChips();
  renderPlanResults();
}
function seedDefaultTime() {
  // Default = next half-hour, in the anchor city's local time.
  const anchor = findCity(planState.anchorId);
  if (!anchor) return;
  const ms = Date.now();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: anchor.tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(ms);
  const m = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  // Round up to the next 30-minute mark.
  let H = parseInt(m.hour, 10), M = parseInt(m.minute, 10);
  if (M < 30) M = 30; else { M = 0; H = (H + 1) % 24; }
  planState.dateStr = `${m.year}-${m.month}-${m.day}`;
  planState.timeStr = `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
}
function rebuildAnchorOptions() {
  planAnchorEl.replaceChildren(...planParticipantCities().map(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.id === store.homeId ? `${c.name}  (home)` : c.name;
    return opt;
  }));
}

// Convert "YYYY-MM-DD HH:MM in TZ" → absolute ms. This is the
// inverse of formatToParts: we don't have a clean Intl API for it, so
// we use the standard offset trick — make a Date in UTC, find what
// it'd appear as in tz, adjust by the delta. Within DST gaps the
// result picks the closest non-ambiguous moment.
function localToAbsoluteMs(dateStr, timeStr, tz) {
  if (!dateStr || !timeStr) return null;
  const [Y, M, D] = dateStr.split('-').map(Number);
  const [h, m]    = timeStr.split(':').map(Number);
  if (![Y, M, D, h, m].every(Number.isFinite)) return null;
  // 1. Build a UTC Date with the requested wall-clock components.
  const utcMs = Date.UTC(Y, M - 1, D, h, m, 0);
  // 2. Read what that absolute moment LOOKS LIKE in the target tz.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(utcMs);
  const o = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const localMsAtUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
  // 3. The offset between target-tz wall-clock and UTC at that moment.
  const offsetMs = localMsAtUtc - utcMs;
  // 4. Subtract that offset from the desired wall-clock-as-utc to get the
  //    real absolute moment.
  return utcMs - offsetMs;
}

// Vibe buckets — mirror the iOS implementation.
function vibeFor(hourLocal) {
  if (hourLocal === 23 || (hourLocal >= 0 && hourLocal < 6)) {
    return { label: 'asleep', glyph: '🌙', klass: 'asleep' };
  }
  if (hourLocal >= 6 && hourLocal < 9)  return { label: 'waking up',   glyph: '☕', klass: 'waking' };
  if (hourLocal >= 9 && hourLocal < 18) return { label: 'working',     glyph: '☀️', klass: 'working' };
  return { label: 'winding down', glyph: '🌇', klass: 'winding' };
}

function renderPlanResults() {
  const anchor = findCity(planState.anchorId);
  if (!anchor) { planResultsEl.replaceChildren(); return; }
  const absMs = localToAbsoluteMs(planState.dateStr, planState.timeStr, anchor.tz);
  if (absMs == null) { planResultsEl.replaceChildren(); return; }

  // Weekend / heads-up note (in anchor tz).
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: anchor.tz, weekday: 'long' }).format(absMs);
  if (dow === 'Saturday' || dow === 'Sunday') {
    planWeekendEl.hidden = false;
    planWeekendEl.textContent = `· ${dow} — heads up, it's the weekend`;
  } else {
    planWeekendEl.hidden = true;
  }

  // Order by offset AT the planned meeting instant — correct even if the
  // meeting date lands on the other side of a DST change from today.
  // Restricted to the cities the user has selected as participants.
  const items = orderedCities(absMs, planParticipantCities()).map(c => {
    const local = formatTime(absMs, c.tz);
    const h = Math.floor(formatHourFraction(absMs, c.tz));
    const v = vibeFor(h);
    const homeKey = anchor.tz ? dayKey(absMs, anchor.tz) : null;
    const cKey = dayKey(absMs, c.tz);
    const offsetLabel = (homeKey && cKey !== homeKey)
      ? ` ${cKey > homeKey ? '+1d' : '−1d'}`
      : '';
    return { c, local, offsetLabel, v };
  });

  planResultsEl.replaceChildren(...items.map(({ c, local, offsetLabel, v }) => {
    const li = document.createElement('li');
    const isHome = c.id === store.homeId;
    const isAnchor = c.id === planState.anchorId;
    if (isHome) li.classList.add('is-home');
    li.innerHTML = `
      <span class="city">${isAnchor ? '<span aria-hidden="true">📍</span>' : ''}${c.name}</span>
      <span class="pt-time">${local}${offsetLabel}</span>
      <span class="vibe ${v.klass}">${v.glyph} ${v.label}</span>
    `;
    return li;
  }));
}

/* ── "Copy details" — iOS-style share text + a Timebase link ── */

// "8 AM" / "8:30 AM" / "20:00" — mirrors the iOS cleanTime(): drops the
// ":00" on whole hours in 12-hour mode, keeps it in 24-hour mode.
function cleanTime(absMs, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
  }).formatToParts(absMs);
  const H = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const M = parseInt(parts.find(p => p.type === 'minute').value, 10);
  let use24;
  if (store.settings.h24 === 'on') use24 = true;
  else if (store.settings.h24 === 'off') use24 = false;
  else use24 = !new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
  if (use24) return `${H}:${String(M).padStart(2, '0')}`;
  const period = H < 12 ? 'AM' : 'PM';
  const h12 = H % 12 === 0 ? 12 : H % 12;
  return M === 0 ? `${h12} ${period}` : `${h12}:${String(M).padStart(2, '0')} ${period}`;
}

function weekdayAbbr(absMs, tz) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(absMs);
}

// The text dropped on the clipboard / share sheet: the proposed time in
// every city (anchor first), plus a Timebase link that reopens this plan.
function planShareText() {
  const anchor = findCity(planState.anchorId);
  if (!anchor) return '';
  const absMs = localToAbsoluteMs(planState.dateStr, planState.timeStr, anchor.tz);
  if (absMs == null) return '';

  const datePhrase = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: anchor.tz,
  }).format(absMs);
  const anchorDay = dayKey(absMs, anchor.tz);
  const participants = planParticipantCities();
  const ordered = [
    anchor,
    ...orderedCities(absMs, participants).filter(c => c.id !== anchor.id),
  ];

  const lines = [`Does ${datePhrase} work?`, ''];
  for (const c of ordered) {
    const h = Math.floor(formatHourFraction(absMs, c.tz));
    let line = `${vibeFor(h).glyph} ${c.name} · ${cleanTime(absMs, c.tz)}`;
    if (dayKey(absMs, c.tz) !== anchorDay) line += ` ${weekdayAbbr(absMs, c.tz)}`;
    lines.push(line);
  }
  lines.push(
    '',
    'See it on Timebase:',
    shareUrl({ includeTime: true, cities: participants }),
  );
  return lines.join('\n');
}

let copyResetTimer = null;
// Confirm the copy on the button itself — it sits in the modal sheet's top
// layer, always in view, and right where the user just clicked. A bottom
// toast would render *under* the sheet and go unseen.
function flashCopied() {
  planCopyBtn.classList.add('is-copied');
  planCopyBtn.textContent = '✓  Copied';
  clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    planCopyBtn.classList.remove('is-copied');
    planCopyBtn.textContent = 'Copy details';
  }, 2400);
}

async function copyPlanDetails() {
  const text = planShareText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    flashCopied();
  } catch {
    // No clipboard (insecure context / denied) — fall back to the OS share
    // sheet on mobile, or a select-and-copy prompt on desktop; both are
    // themselves visible confirmation.
    if (navigator.share) {
      try { await navigator.share({ text }); } catch {}
    } else {
      window.prompt('Copy this:', text);
    }
  }
}

planPill.addEventListener('click', () => openPlanSheet());
planAnchorEl.addEventListener('change', () => { planState.anchorId = planAnchorEl.value; renderPlanResults(); });
planNowBtn.addEventListener('click', () => { seedDefaultTime(); refreshPlanFields(); renderPlanResults(); });
planCopyBtn.addEventListener('click', () => copyPlanDetails());

/* ── Participant picker — searches the FULL city database (~1,500 cities),
      not just the user's tracked list. Tapping a city adds it as a plan
      participant; the sheet stays open so the user can add several before
      tapping Done. ── */
const planPickerSheet   = document.getElementById('plan-picker-sheet');
const planPickerSearch  = document.getElementById('plan-picker-search');
const planPickerLabel   = document.getElementById('plan-picker-label');
const planPickerResults = document.getElementById('plan-picker-results');

function openPlanPickerSheet() {
  planPickerSearch.value = '';
  populatePlanPickerList('');
  planPickerSheet.showModal();
  requestAnimationFrame(() => planPickerSearch.focus());
}
function populatePlanPickerList(query) {
  const q = query.trim().toLowerCase();
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const selected = new Set(planParticipantIds());
  let list;
  if (!q) {
    list = CITY_DB.filter(c => c.popular).slice(0, 12);
    planPickerLabel.textContent = 'Suggested';
  } else {
    list = CITY_DB
      .filter(c => norm(c.name).includes(q) || norm(c.country).includes(q))
      .slice(0, 50);
    planPickerLabel.textContent = list.length ? 'Results' : 'No matches';
  }
  planPickerResults.replaceChildren(...list.map(c => {
    const id = cityId(c);
    const inPlan = selected.has(id);
    const li = document.createElement('li');
    if (inPlan) li.classList.add('is-added');
    li.innerHTML = `<span>${c.name}</span><span class="country">${c.country}${inPlan ? ' · added' : ''}</span>`;
    if (!inPlan) {
      li.addEventListener('click', () => {
        addPlanParticipant(id);
        populatePlanPickerList(planPickerSearch.value);
      });
    }
    return li;
  }));
}
planPickerSearch.addEventListener('input', () => populatePlanPickerList(planPickerSearch.value));

/* ── On-brand date / time pickers — top-layer popovers anchored to the
      DATE / TIME fields, so they're never clipped by the sheet and never
      fall through to the OS's unstyled native picker. ── */

const datePopover   = document.getElementById('date-popover');
const timePopover   = document.getElementById('time-popover');
const planDateBtn   = document.getElementById('plan-date-btn');
const planTimeBtn   = document.getElementById('plan-time-btn');
const planDateValue = document.getElementById('plan-date-value');
const planTimeValue = document.getElementById('plan-time-value');
const calMonthEl    = document.getElementById('cal-month');
const calGridEl     = document.getElementById('cal-grid');
const tpBodyEl      = document.getElementById('tp-body');

const calView = { y: 2026, m: 0 };  // month the calendar is showing

function pad2(n) { return String(n).padStart(2, '0'); }
function ymdKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// True when the user's setting / locale wants 24-hour time.
function uses24h() {
  if (store.settings.h24 === 'on') return true;
  if (store.settings.h24 === 'off') return false;
  return !new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
}

// 'YYYY-MM-DD' → "Wed, May 21"
function dateLabel(s) {
  if (!s) return '—';
  const [Y, M, D] = s.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(Y, M - 1, D));
}
// 'HH:MM' → "4:30 PM" / "16:30"
function timeLabel(s) {
  if (!s) return '—';
  const [H, M] = s.split(':').map(Number);
  if (uses24h()) return `${pad2(H)}:${pad2(M)}`;
  const period = H < 12 ? 'AM' : 'PM';
  const h12 = H % 12 === 0 ? 12 : H % 12;
  return `${h12}:${pad2(M)} ${period}`;
}

function refreshPlanFields() {
  planDateValue.textContent = dateLabel(planState.dateStr);
  planTimeValue.textContent = timeLabel(planState.timeStr);
  planAnchorEl.value = planState.anchorId || '';
}

// Pin a popover just under its field, flipping above / clamping to the
// viewport if it would overflow.
function placePopover(pop, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

/* Calendar */
function openDatePicker() {
  const [Y, M] = (planState.dateStr || ymdKey(new Date())).split('-').map(Number);
  calView.y = Y; calView.m = M - 1;
  renderCalendar();
  datePopover.showPopover();
  placePopover(datePopover, planDateBtn);
}
function renderCalendar() {
  calMonthEl.textContent = new Intl.DateTimeFormat('en-US', {
    month: 'long', year: 'numeric',
  }).format(new Date(calView.y, calView.m, 1));
  const todayKey = ymdKey(new Date());
  const first = new Date(calView.y, calView.m, 1);
  // Back up to the Sunday on or before the 1st; render a fixed 6×7 grid.
  const start = new Date(calView.y, calView.m, 1 - first.getDay());
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = ymdKey(d);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-day';
    btn.textContent = d.getDate();
    if (d.getMonth() !== calView.m) btn.classList.add('is-other');
    if (key === todayKey) btn.classList.add('is-today');
    if (key === planState.dateStr) btn.classList.add('is-selected');
    btn.addEventListener('click', () => {
      planState.dateStr = key;
      refreshPlanFields();
      renderPlanResults();
      datePopover.hidePopover();
    });
    frag.appendChild(btn);
  }
  calGridEl.replaceChildren(frag);
}
document.getElementById('cal-prev').addEventListener('click', () => {
  if (--calView.m < 0) { calView.m = 11; calView.y--; }
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  if (++calView.m > 11) { calView.m = 0; calView.y++; }
  renderCalendar();
});

/* Time picker */
function openTimePicker() {
  renderTimePicker();
  timePopover.showPopover();
  placePopover(timePopover, planTimeBtn);
}
function tpLabel(text) {
  const p = document.createElement('p');
  p.className = 'tp-label';
  p.textContent = text;
  return p;
}
function renderTimePicker() {
  const [H, M] = planState.timeStr.split(':').map(Number);
  const is24 = uses24h();
  const ampm = H < 12 ? 'AM' : 'PM';
  tpBodyEl.replaceChildren();

  // timeStr is canonical 24h; the popover just presents it per the setting.
  const commit = (h, m) => {
    planState.timeStr = `${pad2(h)}:${pad2(m)}`;
    refreshPlanFields();
    renderPlanResults();
    renderTimePicker();   // re-render so the highlight follows the pick
  };

  if (!is24) {
    const row = document.createElement('div');
    row.className = 'tp-ampm';
    for (const p of ['AM', 'PM']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p;
      if (p === ampm) b.classList.add('is-selected');
      b.addEventListener('click', () => {
        const base = H % 12;                          // re-home into the new half
        commit(p === 'PM' ? base + 12 : base, M);
      });
      row.appendChild(b);
    }
    tpBodyEl.appendChild(row);
  }

  tpBodyEl.appendChild(tpLabel('Hour'));
  const hourGrid = document.createElement('div');
  hourGrid.className = 'tp-grid';
  const hours = is24
    ? Array.from({ length: 24 }, (_, i) => i)
    : Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i));
  for (const hh of hours) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'tp-cell';
    cell.textContent = is24 ? pad2(hh) : hh;
    const realH = is24 ? hh : (hh % 12) + (ampm === 'PM' ? 12 : 0);
    if (realH === H) cell.classList.add('is-selected');
    cell.addEventListener('click', () => commit(realH, M));
    hourGrid.appendChild(cell);
  }
  tpBodyEl.appendChild(hourGrid);

  tpBodyEl.appendChild(tpLabel('Minute'));
  const minGrid = document.createElement('div');
  minGrid.className = 'tp-grid';
  for (let mm = 0; mm < 60; mm += 5) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'tp-cell';
    cell.textContent = pad2(mm);
    if (mm === M) cell.classList.add('is-selected');
    cell.addEventListener('click', () => commit(H, mm));
    minGrid.appendChild(cell);
  }
  tpBodyEl.appendChild(minGrid);
}

planDateBtn.addEventListener('click', openDatePicker);
planTimeBtn.addEventListener('click', openTimePicker);
datePopover.addEventListener('toggle', e => {
  planDateBtn.classList.toggle('is-open', e.newState === 'open');
});
timePopover.addEventListener('toggle', e => {
  planTimeBtn.classList.toggle('is-open', e.newState === 'open');
});
// Picker popovers shouldn't outlive the sheet they belong to.
planSheet.addEventListener('close', () => {
  for (const pop of [datePopover, timePopover]) {
    if (pop.matches(':popover-open')) pop.hidePopover();
  }
});

/* ───────────── Share + shortcuts cheat sheet ───────────── */

const shortcutsSheet = document.getElementById('shortcuts-sheet');

/* ───────────── Extended keyboard shortcuts ───────────── */

document.addEventListener('keydown', e => {
  // Don't intercept when an input is focused.
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  // If any dialog is open, let Escape close it (already wired) and skip the rest.
  if (document.querySelector('dialog[open]')) return;

  // Modifier combos pass through to the arrow-key handler defined earlier.
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); openPlanSheet(); }
  else if (k === '/') { e.preventDefault(); openAddSheet(); }
  else if (k === 'i') { e.preventDefault(); openAboutCard(); }
  else if (k === '?') { e.preventDefault(); shortcutsSheet.showModal(); }
});

// First-run welcome — a macOS-style window reusing the About card chrome.
// Three steps inside one window; closes via the red traffic light, Skip, the
// final Got it, or a backdrop click — all routed through the `close` event.
const welcomeSheet = document.getElementById('welcome-sheet');
const welcomeSteps = [...welcomeSheet.querySelectorAll('.welcome-step')];
const welcomeDots  = [...welcomeSheet.querySelectorAll('.welcome-dots .dot')];
let welcomeStep = 0;

function setWelcomeStep(n) {
  welcomeStep = n;
  welcomeSteps.forEach((el, i) => { el.hidden = i !== n; });
  welcomeDots.forEach((d, i) => d.classList.toggle('is-active', i === n));
}
welcomeSheet.querySelectorAll('.welcome-advance').forEach(btn => {
  btn.addEventListener('click', () => setWelcomeStep(welcomeStep + 1));
});
welcomeSheet.addEventListener('close', () => {
  if (!store.hintSeen) { store.hintSeen = true; saveState(); }
});
function maybeShowWelcome() {
  if (store.hintSeen) return;
  setWelcomeStep(0);
  welcomeSheet.showModal();
}

/* ───────────── lifecycle ───────────── */

async function init() {
  loadState();
  await loadCityDB();

  // Shared-link state has highest priority — if the URL specifies cities,
  // they override what's in localStorage for THIS session. We deliberately
  // skip saveState() so the user's own saved list isn't wiped when they
  // open a friend's shared link. Any subsequent mutation (add, remove,
  // make-home) DOES save, which is the natural "I want this to be my
  // default now" gesture.
  const urlState = readUrlState();
  if (urlState) {
    store.cities = urlState.cities;
    store.homeId = urlState.homeId;
    if (urlState.planTime) {
      // For shared plan links, the planned participants ARE the shared cities.
      store.planParticipants = urlState.cities.map(c => c.id);
    }
  } else {
    ensureDefaults();
  }

  applyTheme();
  renderClock();
  maybeShowWelcome();
  setInterval(renderClock, 1000);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderClock());

  // If the link includes a meeting time, open the planner with it.
  if (urlState && urlState.planTime) {
    openPlanSheet({ fromUrl: true, timeStr: urlState.planTime, anchorName: urlState.planAnchor });
  }
}

init();
