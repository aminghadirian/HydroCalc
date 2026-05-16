'use strict';

// ── Physical constants ────────────────────────────────────────────────────
const G       = 9.81;
const TWO_PI  = 2 * Math.PI;
const MAX_ITER = 100;
const TOL      = 1e-8;  // convergence threshold: |Δk / k|

// ── Layer 1: Newton–Raphson solver ────────────────────────────────────────
// Solves ω² = g·k·tanh(k·d) for k given T and d.
// Initial guess k₀ = ω²/g is the exact deep-water solution and ensures
// guaranteed convergence for all physically valid (T, d) pairs.
function solveDispersion(T, d) {
  const omega  = TWO_PI / T;
  const omega2 = omega * omega;

  let k = omega2 / G;  // deep-water initial guess

  for (let i = 0; i < MAX_ITER; i++) {
    const kd    = k * d;
    const tanh  = Math.tanh(kd);
    const sech2 = 1 - tanh * tanh;  // sech²(kd) = 1 - tanh²(kd)

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

// ── Layer 3: Input validation ─────────────────────────────────────────────
function validateInputs(rawT, rawD) {
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

  if (Object.keys(errors).length > 0) return { valid: false, errors };
  return { valid: true, T, d };
}

// ── Layer 4: DOM controller ───────────────────────────────────────────────

// Element references — cached once at startup
const form          = document.getElementById('wave-form');
const periodInput   = document.getElementById('period');
const depthInput    = document.getElementById('depth');
const periodError   = document.getElementById('period-error');
const depthError    = document.getElementById('depth-error');
const resultsEl     = document.getElementById('results');
const solverErrEl   = document.getElementById('solver-error');
const solverErrMsg  = document.getElementById('solver-error-msg');
const badge         = document.getElementById('classification-badge');
const resL          = document.getElementById('res-L');
const resK          = document.getElementById('res-k');
const resC          = document.getElementById('res-C');
const resL0         = document.getElementById('res-L0');
const resDL         = document.getElementById('res-dL');

const BADGE_LABELS = {
  deep:         'Deep Water',
  intermediate: 'Intermediate Water',
  shallow:      'Shallow Water',
};

// Format to 4 significant figures, removing trailing zeros
function fmt(n) {
  return parseFloat(n.toPrecision(4)).toString();
}

function clearErrors() {
  periodError.textContent  = '';
  depthError.textContent   = '';
  solverErrEl.hidden       = true;
  solverErrMsg.textContent = '';
}

function showFieldErrors(errors) {
  if (errors.period) periodError.textContent = errors.period;
  if (errors.depth)  depthError.textContent  = errors.depth;
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

form.addEventListener('submit', (e) => {
  e.preventDefault();
  clearErrors();
  resultsEl.hidden = true;

  const validation = validateInputs(periodInput.value, depthInput.value);

  if (!validation.valid) {
    showFieldErrors(validation.errors);
    return;
  }

  try {
    const props = computeWaveProperties(validation.T, validation.d);
    showResults(props);
  } catch (err) {
    solverErrMsg.textContent = err.message;
    solverErrEl.hidden = false;
  }
});

// Clear per-field errors as soon as the user starts editing
periodInput.addEventListener('input', () => { periodError.textContent = ''; });
depthInput.addEventListener('input',  () => { depthError.textContent  = ''; });
