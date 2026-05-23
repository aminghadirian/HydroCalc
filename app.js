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

// ── Layer 3: Input validation ─────────────────────────────────────────────

// Splits on ; and normalises European decimal comma per token.
function parseMultiRaw(raw) {
  if (!raw || raw.trim() === '') return [];
  return raw.split(';').map(s => s.trim().replace(',', '.'));
}

function validateInputs(rawT, rawD, rawH) {
  const errors  = {};
  const tTokens = parseMultiRaw(rawT);
  const dTokens = parseMultiRaw(rawD);
  const hTokens = parseMultiRaw(rawH);

  // Validate T tokens
  const Ts = [];
  if (tTokens.length === 0) {
    errors.period = 'Wave period is required.';
  } else {
    for (const tok of tTokens) {
      const v = parseFloat(tok);
      if (!tok || isNaN(v)) { errors.period = 'All period values must be valid numbers.'; break; }
      if (v <= 0)            { errors.period = 'Wave period must be greater than 0.';     break; }
      if (v > 1000)          { errors.period = 'Wave period must be ≤ 1000 s.';           break; }
      Ts.push(v);
    }
  }

  // Validate d tokens
  const ds = [];
  if (dTokens.length === 0) {
    errors.depth = 'Water depth is required.';
  } else {
    for (const tok of dTokens) {
      const v = parseFloat(tok);
      if (!tok || isNaN(v)) { errors.depth = 'All depth values must be valid numbers.';             break; }
      if (v <= 0)            { errors.depth = 'Water depth must be greater than 0.';                break; }
      if (v > 11000)         { errors.depth = 'Water depth must be ≤ 11,000 m (Mariana Trench).';  break; }
      ds.push(v);
    }
  }

  // Validate H tokens (optional)
  const Hs = [];
  for (const tok of hTokens) {
    const v = parseFloat(tok);
    if (isNaN(v) || v <= 0) { errors.height = 'Wave height must be greater than 0 if provided.'; break; }
    Hs.push(v);
  }

  if (Object.keys(errors).length > 0) return { valid: false, errors };

  // All multi-valued arrays must be length 1 or the same length N
  const N   = Math.max(Ts.length, ds.length, Hs.length || 0);
  const bad = (arr) => arr.length > 1 && arr.length !== N;
  if (bad(Ts))                   errors.period = `Count mismatch: expected 1 or ${N} value(s).`;
  if (bad(ds))                   errors.depth  = `Count mismatch: expected 1 or ${N} value(s).`;
  if (Hs.length > 0 && bad(Hs)) errors.height = `Count mismatch: expected 1 or ${N} value(s).`;

  if (Object.keys(errors).length > 0) return { valid: false, errors };

  const broadcast = (arr) => arr.length === 1 ? Array(N).fill(arr[0]) : arr;
  return {
    valid: true,
    N,
    Ts: broadcast(Ts),
    ds: broadcast(ds),
    Hs: Hs.length > 0 ? broadcast(Hs) : null,
  };
}

// ── Layer 4: DOM controller ───────────────────────────────────────────────

const BADGE_LABELS = {
  deep:         'Deep Water',
  intermediate: 'Intermediate Water',
  shallow:      'Shallow Water',
};

const PROPS_DEF = [
  { label: 'Wavelength <i>L</i>',                         unit: 'm',         get: p => fmt(p.L)      },
  { label: 'Wave number <i>k</i> = 2&pi;/<i>L</i>',       unit: 'rad/m',     get: p => fmt(p.k)      },
  { label: 'Wave celerity <i>C</i> = <i>L</i>/<i>T</i>',  unit: 'm/s',       get: p => fmt(p.C)      },
  { label: 'Deep-water wavelength <i>L</i><sub>0</sub>',   unit: 'm',         get: p => fmt(p.L0)     },
  { label: 'Relative depth <i>d</i>/<i>L</i>',             unit: '&mdash;',   get: p => fmt(p.dOverL) },
];

// Element references — cached once at startup
const form         = document.getElementById('wave-form');
const periodInput  = document.getElementById('period');
const depthInput   = document.getElementById('depth');
const heightInput  = document.getElementById('height');
const periodError  = document.getElementById('period-error');
const depthError   = document.getElementById('depth-error');
const heightError  = document.getElementById('height-error');
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

function clearErrors() {
  periodError.textContent  = '';
  depthError.textContent   = '';
  heightError.textContent  = '';
  solverErrEl.hidden       = true;
  solverErrMsg.textContent = '';
}

function showFieldErrors(errors) {
  if (errors.period) periodError.textContent = errors.period;
  if (errors.depth)  depthError.textContent  = errors.depth;
  if (errors.height) heightError.textContent = errors.height;
}

function showResults(allProps) {
  // One badge per distinct classification
  const badgeSpans = allProps.map(p =>
    `<span class="classification-badge ${p.classification}">${BADGE_LABELS[p.classification]}</span>`
  );
  const uniq = [...new Set(badgeSpans)];
  badge.innerHTML = uniq.length === 1 ? uniq[0] : badgeSpans.join('');
  badge.className = 'classification-badges';

  // Property blocks: name + unit on top, all values on one line
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

// ── Event handlers ────────────────────────────────────────────────────────

let lastWaves    = null;
let lastAllProps = null;

form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearErrors();
  resultsEl.hidden    = true;
  theorySect.hidden   = true;
  exportCsvBtn.hidden = true;
  saveSvgBtn.hidden   = true;

  const validation = validateInputs(
    periodInput.value,
    depthInput.value,
    heightInput.value,
  );

  if (!validation.valid) {
    showFieldErrors(validation.errors);
    return;
  }

  try {
    const waves = validation.Ts.map((T, i) => ({
      T,
      d: validation.ds[i],
      H: validation.Hs ? validation.Hs[i] : undefined,
    }));
    const allProps = waves.map(w => computeWaveProperties(w.T, w.d));

    showResults(allProps);
    lastWaves    = waves;
    lastAllProps = allProps;
    exportCsvBtn.hidden = false;

    const points = waves.map(w =>
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

periodInput.addEventListener('input', () => { periodError.textContent = ''; });
depthInput.addEventListener('input',  () => { depthError.textContent  = ''; });
heightInput.addEventListener('input', () => { heightError.textContent = ''; });
