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
  const { k, iterations } = solveDispersion(T, d);

  const L      = TWO_PI / k;
  const C      = L / T;
  const L0     = G * T * T / TWO_PI;
  const dOverL = d / L;

  let classification;
  if (dOverL > 0.5)        classification = 'deep';
  else if (dOverL > 0.05)  classification = 'intermediate';
  else                     classification = 'shallow';

  return { k, L, C, L0, dOverL, classification, iterations };
}

// ── Layer 2.5: Wave theory classification ─────────────────────────────────
function classifyWaveTheory(H, k, L, d) {
  const dOverL = d / L;
  const HOverL = H / L;
  const HOverd = H / d;
  const kd     = k * d;
  const tanhkd = Math.tanh(kd);

  // Breaking — Miche (1951)
  if (HOverL >= 0.142 * tanhkd) return 'breaking';
  // Breaking — McCowan (shallow water)
  if (HOverd >= 0.78 && dOverL <= 0.05) return 'breaking';

  // Shallow water (d/L ≤ 0.05): cnoidal throughout the plotted range
  if (dOverL <= 0.05) {
    if (HOverd >= 0.55) return 'solitary';
    return 'cnoidal';
  }

  // Intermediate to deep water
  // Ursell number with ACTUAL wavelength — matches the reference's Hλ²/h³=26 boundary
  const Ur = H * L * L / (d * d * d);
  if (Ur >= 26) return 'cnoidal';   // 5th-order stream function region in reference

  // Sub-order boundaries (approximate; analytically inexpressible per Le Méhaut 1976):
  //   H = HB/4 labels the Stokes 4th/3rd transition in the reference figure
  //   H/L₀ = 0.006 is the horizontal line separating Stokes 2nd from linear theory
  const HB = 0.142 * tanhkd * L;
  if (H / HB >= 0.35) return 'stokes4';
  if (H / HB >= 0.15) return 'stokes3';
  const L0 = L / tanhkd;
  if (H / L0 >= 0.006) return 'stokes2';
  return 'linear';
}

// ── Layer 3: Input validation ─────────────────────────────────────────────
function validateInputs(rawT, rawD, rawH) {
  const errors = {};
  const T = parseFloat(rawT);
  const d = parseFloat(rawD);

  if (rawT.trim() === '' || isNaN(T)) {
    errors.period = 'Wave period is required.';
  } else if (T <= 0) {
    errors.period = 'Wave period must be greater than 0.';
  } else if (T > 1000) {
    errors.period = 'Wave period must be ≤ 1000 s.';
  }

  if (rawD.trim() === '' || isNaN(d)) {
    errors.depth = 'Water depth is required.';
  } else if (d <= 0) {
    errors.depth = 'Water depth must be greater than 0.';
  } else if (d > 11000) {
    errors.depth = 'Water depth must be ≤ 11,000 m (Mariana Trench depth).';
  }

  let H;
  if (rawH !== undefined && rawH.trim() !== '') {
    const parsedH = parseFloat(rawH);
    if (isNaN(parsedH) || parsedH <= 0) {
      errors.height = 'Wave height must be greater than 0 if provided.';
    } else {
      H = parsedH;
    }
  }

  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return { valid: true, T, d, H };
}

// ── Layer 4: DOM controller ───────────────────────────────────────────────

const BADGE_LABELS = {
  deep:         'Deep Water',
  intermediate: 'Intermediate Water',
  shallow:      'Shallow Water',
};

const THEORY_COLORS = {
  linear:   '#1565c0',
  stokes2:  '#2e7d32',
  stokes3:  '#e65100',
  stokes4:  '#4e342e',
  cnoidal:  '#6a1b9a',
  solitary: '#795548',
  breaking: '#c62828',
};

const THEORY_LABELS = {
  linear:   'Linear (Airy)',
  stokes2:  'Stokes 2nd Order',
  stokes3:  'Stokes 3rd Order',
  stokes4:  'Stokes 4th Order',
  cnoidal:  'Cnoidal Wave',
  solitary: 'Solitary Wave',
  breaking: 'Breaking Wave',
};

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
const resL         = document.getElementById('res-L');
const resK         = document.getElementById('res-k');
const resC         = document.getElementById('res-C');
const resL0        = document.getElementById('res-L0');
const resDL        = document.getElementById('res-dL');
const theorySect   = document.getElementById('theory-section');
const theoryBadge  = document.getElementById('theory-badge');
const lehautPlot   = document.getElementById('lehaut-plot');

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

function showResults(props) {
  const { k, L, C, L0, dOverL, classification } = props;

  resL.textContent  = fmt(L);
  resK.textContent  = fmt(k);
  resC.textContent  = fmt(C);
  resL0.textContent = fmt(L0);
  resDL.textContent = fmt(dOverL);

  badge.className   = `classification-badge ${classification}`;
  badge.textContent = BADGE_LABELS[classification];

  resultsEl.hidden = false;
}

// ── Le Méhaut SVG builder ─────────────────────────────────────────────────
function buildLeMehautSVG(userX, userY, theory) {
  // Coordinate system of Water_wave_theories.svg (640×720, LaTeX/PGF-generated)
  const VW = 640, VH = 720;
  const ML = 135.11, MR = 608.87, MT = 51.96, MB = 604.51;
  const PW = MR - ML, PH = MB - MT;

  // Axis limits: x = d/gT² ∈ [0.001, 0.2], y = H/gT² ∈ [5e-5, 0.05] (log scale)
  const XMIN = -3, XMAX = Math.log10(0.2);
  const YMIN = Math.log10(5e-5), YMAX = Math.log10(0.05);

  function toSVG(domX, domY) {
    if (domX <= 0 || domY <= 0) return null;
    const lx = Math.log10(domX), ly = Math.log10(domY);
    if (!isFinite(lx) || !isFinite(ly)) return null;
    const px = ML + (lx - XMIN) / (XMAX - XMIN) * PW;
    const py = MB - (ly - YMIN) / (YMAX - YMIN) * PH;
    return [px, py];
  }

  function userDot() {
    if (!userX || !userY) return '';
    const sv = toSVG(userX, userY);
    if (!sv) return '';
    const [ux, uy] = [sv[0].toFixed(1), sv[1].toFixed(1)];
    const color = THEORY_COLORS[theory] || '#333';
    return `
      <line x1="${ML.toFixed(1)}" y1="${uy}" x2="${MR.toFixed(1)}" y2="${uy}"
            stroke="${color}" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.8"/>
      <line x1="${ux}" y1="${MT.toFixed(1)}" x2="${ux}" y2="${MB.toFixed(1)}"
            stroke="${color}" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.8"/>
      <circle cx="${ux}" cy="${uy}" r="7" fill="${color}" stroke="#fff" stroke-width="2.5"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg"
               xmlns:xlink="http://www.w3.org/1999/xlink"
               width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}"
               role="img" aria-label="Le Méhaut wave theory applicability diagram">
  <image href="Water_wave_theories.svg" width="${VW}" height="${VH}"/>
  ${userDot()}
</svg>`;
}

// ── Event handlers ────────────────────────────────────────────────────────
form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearErrors();
  resultsEl.hidden  = true;
  theorySect.hidden = true;

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
    const props = computeWaveProperties(validation.T, validation.d);
    showResults(props);

    if (validation.H !== undefined) {
      const { k, L } = props;
      const theory = classifyWaveTheory(validation.H, k, L, validation.d);

      theoryBadge.textContent   = THEORY_LABELS[theory];
      theoryBadge.dataset.theory = theory;

      const gT2   = G * validation.T * validation.T;
      const userX = validation.d / gT2;
      const userY = validation.H / gT2;

      lehautPlot.innerHTML = buildLeMehautSVG(userX, userY, theory);
      theorySect.hidden    = false;
    }
  } catch (err) {
    solverErrMsg.textContent = err.message;
    solverErrEl.hidden = false;
  }
});

periodInput.addEventListener('input', () => { periodError.textContent = ''; });
depthInput.addEventListener('input',  () => { depthError.textContent  = ''; });
heightInput.addEventListener('input', () => { heightError.textContent = ''; });
