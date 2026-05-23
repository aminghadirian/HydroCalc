'use strict';

// ── Physical constants ────────────────────────────────────────────────────
const G        = 9.81;
const TWO_PI   = 2 * Math.PI;
const MAX_ITER = 100;
const TOL      = 1e-8;

// ── Layer 1: Newton–Raphson solver ────────────────────────────────────────
// Solves ω² = g·k·tanh(k·d) for k given T and d.
// Initial guess k₀ = ω²/g is exact in deep water and guarantees convergence.
function solveDispersion(T, d) {
  const omega  = TWO_PI / T;
  const omega2 = omega * omega;

  let k = omega2 / G;

  for (let i = 0; i < MAX_ITER; i++) {
    const kd    = k * d;
    const tanh  = Math.tanh(kd);
    const sech2 = 1 - tanh * tanh;

    const f  = omega2 - G * k * tanh;
    const fp = -G * (tanh + kd * sech2);

    const dk = f / fp;
    k -= dk;

    if (Math.abs(dk / k) < TOL) {
      return { k, iterations: i + 1 };
    }
  }

  throw new Error(
    `Newton–Raphson did not converge after ${MAX_ITER} iterations. ` +
    `Verify that T and d are physically reasonable values.`
  );
}

// ── Layer 2: Derived wave properties ─────────────────────────────────────
function computeWaveProperties(T, d) {
  const { k } = solveDispersion(T, d);

  const L      = TWO_PI / k;
  const C      = L / T;
  const L0     = G * T * T / TWO_PI;
  const dOverL = d / L;

  let classification;
  if (dOverL > 0.5)        classification = 'deep';
  else if (dOverL > 0.05)  classification = 'intermediate';
  else                     classification = 'shallow';

  return { k, L, C, L0, dOverL, classification };
}

// ── Layer 3: Row-based validation ─────────────────────────────────────────
function validateAllRows() {
  const rows  = Array.from(waveRowsEl.querySelectorAll('.wave-row'));
  const msgs  = [];
  const waves = [];
  let allOk   = true;

  rows.forEach((row, i) => {
    const n   = i + 1;
    const inp = {
      T: row.querySelector('.wave-T'),
      d: row.querySelector('.wave-d'),
      H: row.querySelector('.wave-H'),
    };
    const raw = {
      T: inp.T.value.trim().replace(',', '.'),
      d: inp.d.value.trim().replace(',', '.'),
      H: inp.H.value.trim().replace(',', '.'),
    };

    let rowOk = true;
    const mark = (el, msg) => {
      el.classList.add('is-invalid');
      msgs.push(msg);
      rowOk = false;
    };

    const T = parseFloat(raw.T);
    if (!raw.T || isNaN(T))  mark(inp.T, `Wave ${n}: period is required.`);
    else if (T <= 0)          mark(inp.T, `Wave ${n}: period must be > 0.`);
    else if (T > 1000)        mark(inp.T, `Wave ${n}: period must be ≤ 1000 s.`);

    const d = parseFloat(raw.d);
    if (!raw.d || isNaN(d))  mark(inp.d, `Wave ${n}: depth is required.`);
    else if (d <= 0)          mark(inp.d, `Wave ${n}: depth must be > 0.`);
    else if (d > 11000)       mark(inp.d, `Wave ${n}: depth must be ≤ 11,000 m.`);

    let H;
    if (raw.H !== '') {
      const v = parseFloat(raw.H);
      if (isNaN(v) || v <= 0) mark(inp.H, `Wave ${n}: height must be > 0 if provided.`);
      else H = v;
    }

    if (rowOk) waves.push({ T, d, H });
    else allOk = false;
  });

  if (!allOk) return { valid: false, msgs };
  return { valid: true, waves };
}

// ── Layer 4: DOM controller ───────────────────────────────────────────────

const BADGE_LABELS = {
  deep:         'Deep Water',
  intermediate: 'Intermediate Water',
  shallow:      'Shallow Water',
};

const PROPS_DEF = [
  { label: 'Wavelength <i>L</i>',                              unit: 'm',     get: p => fmt(p.L)      },
  { label: 'Wave number <i>k</i> = 2&pi;/<i>L</i>',           unit: 'rad/m', get: p => fmt(p.k)      },
  { label: 'Wave celerity <i>C</i> = <i>L</i>/<i>T</i>',      unit: 'm/s',   get: p => fmt(p.C)      },
  { label: 'Deep-water wavelength <i>L</i><sub>0</sub>',       unit: 'm',     get: p => fmt(p.L0)     },
  { label: 'Relative depth <i>d</i>/<i>L</i>',                 unit: '&mdash;', get: p => fmt(p.dOverL) },
];

// Element references — cached once at startup
const form         = document.getElementById('wave-form');
const waveRowsEl   = document.getElementById('wave-rows');
const addRowBtn    = document.getElementById('add-row-btn');
const rowErrorsEl  = document.getElementById('row-errors');
const resultsEl    = document.getElementById('results');
const solverErrEl  = document.getElementById('solver-error');
const solverErrMsg = document.getElementById('solver-error-msg');
const badge        = document.getElementById('classification-badge');
const propsGrid    = document.getElementById('props-grid');
const theorySect   = document.getElementById('theory-section');
const lehautPlot   = document.getElementById('lehaut-plot');
const exportCsvBtn = document.getElementById('export-csv-btn');
const saveSvgBtn   = document.getElementById('save-svg-btn');

function fmt(n) {
  return parseFloat(n.toPrecision(4)).toString();
}

// ── Row lifecycle ─────────────────────────────────────────────────────────
function createWaveRow(idx) {
  const div        = document.createElement('div');
  div.className    = 'wave-row';
  div.dataset.idx  = idx;
  div.innerHTML = `
    <span class="row-num">${idx + 1}</span>
    <input type="text" inputmode="decimal" class="wave-T"
           placeholder="10"  aria-label="Wave period ${idx + 1} (s)"/>
    <input type="text" inputmode="decimal" class="wave-d"
           placeholder="25"  aria-label="Water depth ${idx + 1} (m)"/>
    <input type="text" inputmode="decimal" class="wave-H"
           placeholder="opt" aria-label="Wave height ${idx + 1} (m)"/>
    <button type="button" class="remove-row-btn" aria-label="Remove wave ${idx + 1}">&times;</button>`;
  return div;
}

function updateRowNumbers() {
  waveRowsEl.querySelectorAll('.wave-row').forEach((row, i) => {
    row.querySelector('.row-num').textContent = i + 1;
    row.dataset.idx = i;
    row.querySelector('.wave-T').setAttribute('aria-label', `Wave period ${i + 1} (s)`);
    row.querySelector('.wave-d').setAttribute('aria-label', `Water depth ${i + 1} (m)`);
    row.querySelector('.wave-H').setAttribute('aria-label', `Wave height ${i + 1} (m)`);
    row.querySelector('.remove-row-btn').setAttribute('aria-label', `Remove wave ${i + 1}`);
  });
}

function updateRemoveButtons() {
  const rows = waveRowsEl.querySelectorAll('.wave-row');
  rows.forEach(row => {
    row.querySelector('.remove-row-btn').hidden = rows.length === 1;
  });
}

// Initialise with one row
waveRowsEl.appendChild(createWaveRow(0));
updateRemoveButtons();

// ── Row event delegation ──────────────────────────────────────────────────
addRowBtn.addEventListener('click', () => {
  const n   = waveRowsEl.querySelectorAll('.wave-row').length;
  const row = createWaveRow(n);
  waveRowsEl.appendChild(row);
  updateRemoveButtons();
  row.querySelector('.wave-T').focus();
});

waveRowsEl.addEventListener('click', (e) => {
  if (!e.target.classList.contains('remove-row-btn')) return;
  e.target.closest('.wave-row').remove();
  updateRowNumbers();
  updateRemoveButtons();
});

waveRowsEl.addEventListener('input', (e) => {
  if (e.target.tagName === 'INPUT') e.target.classList.remove('is-invalid');
  rowErrorsEl.hidden = true;
});

// ── Error helpers ─────────────────────────────────────────────────────────
function clearErrors() {
  rowErrorsEl.hidden       = true;
  rowErrorsEl.innerHTML    = '';
  waveRowsEl.querySelectorAll('input.is-invalid')
    .forEach(el => el.classList.remove('is-invalid'));
  solverErrEl.hidden       = true;
  solverErrMsg.textContent = '';
}

function showRowErrors(msgs) {
  rowErrorsEl.innerHTML = msgs.map(m => `<p>${m}</p>`).join('');
  rowErrorsEl.hidden    = false;
}

// ── Results display ───────────────────────────────────────────────────────
function showResults(allProps) {
  // Classification badges — one per distinct classification
  const badgeSpans = allProps.map(p =>
    `<span class="classification-badge ${p.classification}">${BADGE_LABELS[p.classification]}</span>`
  );
  const uniq = [...new Set(badgeSpans)];
  badge.innerHTML = uniq.length === 1 ? uniq[0] : badgeSpans.join('');
  badge.className = 'classification-badges';

  // Property blocks: label + unit on top, all values on one line separated by " ; "
  propsGrid.innerHTML = PROPS_DEF.map(({ label, unit, get }) =>
    `<div class="prop-block">
      <div class="prop-label">${label} <span class="prop-unit">[${unit}]</span></div>
      <div class="prop-values">${allProps.map(get).join(' &nbsp;;&nbsp; ')}</div>
    </div>`
  ).join('');

  resultsEl.hidden = false;
}

// ── Le Méhaut SVG builder ─────────────────────────────────────────────────
function buildLeMehautSVG(points) {
  // points: array of { x, y } | null — domain coords (d/gT², H/gT²)
  // Coordinate system of Water_wave_theories.svg (640×720, LaTeX/PGF-generated)
  const VW = 640, VH = 720;
  const ML = 135.11, MR = 608.87, MT = 51.96, MB = 604.51;
  const PW = MR - ML, PH = MB - MT;

  // Axis limits: x = d/gT² ∈ [0.0005, 0.2], y = H/gT² ∈ [5e-5, 0.05] (log scale)
  const XMIN = Math.log10(0.0005), XMAX = Math.log10(0.2);
  const YMIN = Math.log10(5e-5),   YMAX = Math.log10(0.05);

  function toSVG(domX, domY) {
    if (domX <= 0 || domY <= 0) return null;
    const lx = Math.log10(domX), ly = Math.log10(domY);
    if (!isFinite(lx) || !isFinite(ly)) return null;
    const px = ML + (lx - XMIN) / (XMAX - XMIN) * PW;
    const py = MB - (ly - YMIN) / (YMAX - YMIN) * PH;
    return [px, py];
  }

  function userDots() {
    const color = '#e53935';
    return points.map((pt, i) => {
      if (!pt || !pt.x || !pt.y) return '';
      const sv = toSVG(pt.x, pt.y);
      if (!sv) return '';
      const ux     = sv[0].toFixed(1);
      const uy     = sv[1].toFixed(1);
      const labelX = (sv[0] + 10).toFixed(1);
      const labelY = (sv[1] - 10).toFixed(1);
      return `
      <line x1="${ML.toFixed(1)}" y1="${uy}" x2="${MR.toFixed(1)}" y2="${uy}"
            stroke="${color}" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.7"/>
      <line x1="${ux}" y1="${MT.toFixed(1)}" x2="${ux}" y2="${MB.toFixed(1)}"
            stroke="${color}" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.7"/>
      <circle cx="${ux}" cy="${uy}" r="7" fill="${color}" stroke="#fff" stroke-width="2.5"/>
      <text x="${labelX}" y="${labelY}" font-size="14" font-weight="bold"
            fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${i + 1}</text>`;
    }).join('');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg"
               xmlns:xlink="http://www.w3.org/1999/xlink"
               width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}"
               role="img" aria-label="Le Méhaut wave theory applicability diagram">
  <image href="Water_wave_theories.svg" width="${VW}" height="${VH}"/>
  ${userDots()}
</svg>`;
}

// ── CSV export ────────────────────────────────────────────────────────────
function exportCSV(waves, allProps) {
  const header = 'Wave #,T (s),d (m),H (m),L (m),k (rad/m),C (m/s),L0 (m),d/L,Classification';
  const rows = allProps.map((p, i) => [
    i + 1,
    waves[i].T,
    waves[i].d,
    waves[i].H !== undefined ? waves[i].H : '',
    fmt(p.L), fmt(p.k), fmt(p.C), fmt(p.L0), fmt(p.dOverL),
    BADGE_LABELS[p.classification],
  ].join(','));
  const csv  = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'hydrocalc.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Submit handler ────────────────────────────────────────────────────────

let lastWaves    = null;
let lastAllProps = null;

form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearErrors();
  resultsEl.hidden    = true;
  theorySect.hidden   = true;
  exportCsvBtn.hidden = true;
  saveSvgBtn.hidden   = true;

  const v = validateAllRows();
  if (!v.valid) {
    showRowErrors(v.msgs);
    return;
  }

  try {
    const allProps = v.waves.map(w => computeWaveProperties(w.T, w.d));
    showResults(allProps);
    lastWaves    = v.waves;
    lastAllProps = allProps;
    exportCsvBtn.hidden = false;

    const points = v.waves.map(w =>
      w.H !== undefined
        ? { x: w.d / (G * w.T * w.T), y: w.H / (G * w.T * w.T) }
        : null
    );

    if (points.some(p => p !== null)) {
      lehautPlot.innerHTML = buildLeMehautSVG(points);
      theorySect.hidden    = false;
      saveSvgBtn.hidden    = false;
    }
  } catch (err) {
    solverErrMsg.textContent = err.message;
    solverErrEl.hidden = false;
  }
});

exportCsvBtn.addEventListener('click', () => {
  if (lastWaves && lastAllProps) exportCSV(lastWaves, lastAllProps);
});

saveSvgBtn.addEventListener('click', () => {
  const svgEl = lehautPlot.querySelector('svg');
  if (!svgEl) return;
  const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'lehaut.svg';
  a.click();
  URL.revokeObjectURL(a.href);
});
