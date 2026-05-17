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

  // Breaking — Miche (1951)
  if (HOverL >= 0.142 * Math.tanh(kd)) return 'breaking';

  // Breaking — McCowan (shallow water)
  if (HOverd >= 0.78 && dOverL <= 0.05) return 'breaking';

  // Ur₀ uses deep-water wavelength L₀ = L/tanh(kd), matching the diagram's slope-3 lines
  const L0  = L / Math.tanh(kd);
  const Ur0 = H * L0 * L0 / (d * d * d);

  // Intermediate to deep: Stokes regime; thresholds match y = 4π²x³, 125x³, 350x³
  if (dOverL > 0.05) {
    if (Ur0 >= 350 / (4 * Math.PI * Math.PI)) return 'stokes4';
    if (Ur0 >= 125 / (4 * Math.PI * Math.PI)) return 'stokes3';
    if (Ur0 >= 1.0)                            return 'stokes2';
    return 'linear';
  }

  // Shallow: Cnoidal vs Solitary at H/d = 0.45 (matches y = 0.45x boundary)
  if (HOverd >= 0.45) return 'solitary';
  return 'cnoidal';
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
  const VW = 560, VH = 420;
  const ML = 65, MT = 20, MR = 540, MB = 345;
  const PW = MR - ML;
  const PH = MB - MT;

  // Log₁₀ axis limits matching reference: X 0.001→0.2, Y 5e-5→0.05
  const XMIN = -3,                   XMAX = Math.log10(0.2);
  const YMIN = Math.log10(5e-5),     YMAX = Math.log10(0.05);

  function toSVG(domX, domY) {
    if (domX <= 0 || domY <= 0) return null;
    const lx = Math.log10(domX);
    const ly = Math.log10(domY);
    if (!isFinite(lx) || !isFinite(ly)) return null;
    const px = ML + (lx - XMIN) / (XMAX - XMIN) * PW;
    const py = MB - (ly - YMIN) / (YMAX - YMIN) * PH;
    return [px, py];
  }

  // Compute all boundary curves (200 log-spaced x values, T_ref = 1 s)
  const N = 200;
  const xVals       = [];
  const lambdaVals  = [];
  const michePts    = [];
  const mccowanPts  = [];
  const solCnPts    = [];   // y = 0.45x    (Cnoidal / Solitary boundary)
  const linSt2Pts   = [];   // y = 4π²x³   (Linear / Stokes 2nd, Ur₀ = 1)
  const st23Pts     = [];   // y = 125x³   (Stokes 2nd / 3rd, Ur₀ ≈ 3.16)
  const st34Pts     = [];   // y = 350x³   (Stokes 3rd / V, Ur₀ ≈ 8.87)
  const breakEnvPts = [];   // min(Miche, McCowan) for polygon fills

  for (let i = 0; i < N; i++) {
    const logX  = XMIN + i / (N - 1) * (XMAX - XMIN);
    const x     = Math.pow(10, logX);
    const d_ref = x * G;

    let lambda, kd_ref, tanh_kd;
    try {
      const { k } = solveDispersion(1, d_ref);
      lambda  = (TWO_PI / k) / G;
      kd_ref  = k * d_ref;
      tanh_kd = Math.tanh(kd_ref);
    } catch (_) {
      xVals.push(x); lambdaVals.push(null);
      michePts.push(null); mccowanPts.push(null);
      solCnPts.push(null); linSt2Pts.push(null);
      st23Pts.push(null); st34Pts.push(null);
      breakEnvPts.push(null);
      continue;
    }

    xVals.push(x); lambdaVals.push(lambda);

    const yMiche    = 0.142 * tanh_kd * lambda;
    const yMcCowan  = 0.78 * x;
    const yBreakEff = Math.min(yMiche, yMcCowan);
    // Analytical straight-line boundaries (slope-3 on log-log via Ur₀; slope-1 for solitary)
    const yLinSt2   = 4 * Math.PI * Math.PI * x * x * x;  // Ur₀ = 1
    const ySt23     = 125 * x * x * x;                     // Ur₀ ≈ 3.16
    const ySt34     = 350 * x * x * x;                     // Ur₀ ≈ 8.87
    const ySolCn    = 0.45 * x;                            // Cnoidal / Solitary

    michePts.push(isFinite(yMiche)   ? [x, yMiche]   : null);
    mccowanPts.push([x, yMcCowan]);
    // Clip internal curves at breaking envelope
    solCnPts.push((isFinite(ySolCn)   && ySolCn   < yBreakEff) ? [x, ySolCn]   : null);
    linSt2Pts.push((isFinite(yLinSt2) && yLinSt2  < yBreakEff) ? [x, yLinSt2]  : null);
    st23Pts.push((isFinite(ySt23)     && ySt23    < yBreakEff) ? [x, ySt23]    : null);
    st34Pts.push((isFinite(ySt34)     && ySt34    < yBreakEff) ? [x, ySt34]    : null);
    breakEnvPts.push(isFinite(yBreakEff) ? [x, yBreakEff] : null);
  }

  // Analytical depth boundaries: d/L = 0.5 → x ≈ 0.08 (deep); d/L = 0.05 → x ≈ 0.0025 (shallow)
  const _svDeep    = toSVG(0.08,   1e-3);
  const _svShallow = toSVG(0.0025, 1e-3);
  const xDeepPx    = _svDeep    ? _svDeep[0]    : null;
  const xShallowPx = _svShallow ? _svShallow[0] : null;

  // Build polyline(s); null entries create gaps
  function makeCurve(pts, stroke, dasharray, width) {
    const segments = [];
    let current    = [];
    for (const pt of pts) {
      if (pt === null) {
        if (current.length >= 2) segments.push(current);
        current = [];
        continue;
      }
      const sv = toSVG(pt[0], pt[1]);
      if (sv === null) {
        if (current.length >= 2) segments.push(current);
        current = [];
      } else {
        current.push(sv);
      }
    }
    if (current.length >= 2) segments.push(current);
    const da = dasharray ? `stroke-dasharray="${dasharray}"` : '';
    return segments.map(seg => {
      const pStr = seg.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      return `<polyline points="${pStr}" fill="none" stroke="${stroke}" stroke-width="${width}" ${da} stroke-linecap="round" clip-path="url(#plot-clip)"/>`;
    }).join('');
  }

  // ── Shaded regions ────────────────────────────────────────────────────────

  // Linear (Airy) region: below the y = 4π²x³ line (linSt2Pts) across the full plot width
  function linearFill() {
    const upper = [];
    for (const pt of linSt2Pts) {
      if (pt === null) continue;
      const sv = toSVG(pt[0], pt[1]);
      if (sv) upper.push(sv);
    }
    if (upper.length < 2) return '';
    const pts = [[ML, MB], [MR, MB], ...upper.slice().reverse()];
    const pStr = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    return `<polygon points="${pStr}" fill="#90a4ae" opacity="0.35" clip-path="url(#plot-clip)"/>`;
  }

  // Cnoidal region: between y = 0.45x (solCnPts) and the breaking envelope (shallow zone)
  function cnoidalFill() {
    const solSVG = [];
    for (const pt of solCnPts) {
      if (pt === null) continue;
      const sv = toSVG(pt[0], pt[1]);
      if (sv) solSVG.push(sv);
    }
    const envSVG = [];
    for (const pt of breakEnvPts) {
      if (pt === null) continue;
      const sv = toSVG(pt[0], pt[1]);
      if (sv) envSVG.push(sv);
    }
    if (solSVG.length < 2 || envSVG.length < 2) return '';
    const maxX = solSVG[solSVG.length - 1][0];
    const envClipped = envSVG.filter(p => p[0] <= maxX + 1);
    const pts = [...solSVG, ...envClipped.slice().reverse()];
    const pStr = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    return `<polygon points="${pStr}" fill="#b0bec5" opacity="0.3" clip-path="url(#plot-clip)"/>`;
  }

  // Breaking zone: above effective breaking envelope
  function breakingPolygon() {
    const envSVG = [];
    for (const pt of breakEnvPts) {
      if (pt === null) continue;
      const sv = toSVG(pt[0], pt[1]);
      if (sv) envSVG.push(sv);
    }
    if (envSVG.length < 2) return '';
    const pts = [[ML, MT], [MR, MT], ...envSVG.slice().reverse()];
    const pStr = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    return `<polygon points="${pStr}" fill="#ffcdd2" opacity="0.55" clip-path="url(#plot-clip)"/>`;
  }

  // Vertical depth classification lines
  function depthLines() {
    let s = '';
    if (xDeepPx !== null) {
      s += `<line x1="${xDeepPx.toFixed(1)}" y1="${MT}" x2="${xDeepPx.toFixed(1)}" y2="${MB}" stroke="#555" stroke-width="0.8" stroke-dasharray="5,4" clip-path="url(#plot-clip)"/>`;
    }
    if (xShallowPx !== null) {
      s += `<line x1="${xShallowPx.toFixed(1)}" y1="${MT}" x2="${xShallowPx.toFixed(1)}" y2="${MB}" stroke="#555" stroke-width="0.8" stroke-dasharray="5,4" clip-path="url(#plot-clip)"/>`;
    }
    // Zone labels below x-axis
    const ly = MB + 28;
    if (xDeepPx !== null && xShallowPx !== null) {
      const deepMid = ((xDeepPx + MR) / 2).toFixed(1);
      const intMid  = ((xDeepPx + xShallowPx) / 2).toFixed(1);
      const shalMid = ((ML + xShallowPx) / 2).toFixed(1);
      s += `<text x="${deepMid}" y="${ly}" text-anchor="middle" font-size="9" fill="#555">deep</text>`;
      s += `<text x="${intMid}"  y="${ly}" text-anchor="middle" font-size="9" fill="#555">intermediate</text>`;
      s += `<text x="${shalMid}" y="${ly}" text-anchor="middle" font-size="9" fill="#555">shallow</text>`;
    }
    return s;
  }

  // Log-decade grid lines
  function grid() {
    const xGridVals = [0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009,
                       0.01,  0.02,  0.03,  0.04,  0.05,  0.06,  0.07,  0.08,  0.09,
                       0.1,   0.2];
    const yGridVals = [5e-5, 6e-5, 7e-5, 8e-5, 9e-5,
                       1e-4, 2e-4, 3e-4, 4e-4, 5e-4, 6e-4, 7e-4, 8e-4, 9e-4,
                       1e-3, 2e-3, 3e-3, 4e-3, 5e-3, 6e-3, 7e-3, 8e-3, 9e-3,
                       1e-2, 2e-2, 3e-2, 4e-2, 5e-2];
    let g = '';
    for (const xv of xGridVals) {
      const sv = toSVG(xv, 1e-3);
      if (!sv) continue;
      const isDec = Number.isInteger(Math.round(Math.log10(xv) * 1000) / 1000);
      g += `<line x1="${sv[0].toFixed(1)}" y1="${MT}" x2="${sv[0].toFixed(1)}" y2="${MB}" stroke="#e2e8f0" stroke-width="${isDec ? 0.8 : 0.4}" clip-path="url(#plot-clip)"/>`;
    }
    for (const yv of yGridVals) {
      const sv = toSVG(0.01, yv);
      if (!sv) continue;
      const lv = Math.log10(yv);
      const isDec = Math.abs(lv - Math.round(lv)) < 0.001;
      g += `<line x1="${ML}" y1="${sv[1].toFixed(1)}" x2="${MR}" y2="${sv[1].toFixed(1)}" stroke="#e2e8f0" stroke-width="${isDec ? 0.8 : 0.4}" clip-path="url(#plot-clip)"/>`;
    }
    return g;
  }

  // Axis ticks and labels
  function axes() {
    let s = '';
    const xMajor = [[0.001, '10⁻³'], [0.01, '10⁻²'], [0.1, '10⁻¹']];
    const xMinor = [0.002, 0.005, 0.02, 0.05, 0.2];
    for (const [xv, lbl] of xMajor) {
      const sv = toSVG(xv, 1e-3);
      if (!sv) continue;
      const px = sv[0].toFixed(1);
      s += `<line x1="${px}" y1="${MB}" x2="${px}" y2="${MB + 5}" stroke="#555" stroke-width="1"/>`;
      s += `<text x="${px}" y="${MB + 16}" text-anchor="middle" font-size="11" fill="#444">${lbl}</text>`;
    }
    for (const xv of xMinor) {
      const sv = toSVG(xv, 1e-3);
      if (!sv) continue;
      s += `<line x1="${sv[0].toFixed(1)}" y1="${MB}" x2="${sv[0].toFixed(1)}" y2="${MB + 3}" stroke="#888" stroke-width="0.8"/>`;
    }
    const yMajor = [[1e-4, '10⁻⁴'], [1e-3, '10⁻³'], [1e-2, '10⁻²']];
    const yMinor = [5e-5, 5e-4, 5e-3, 5e-2];
    for (const [yv, lbl] of yMajor) {
      const sv = toSVG(0.01, yv);
      if (!sv) continue;
      const py = sv[1].toFixed(1);
      s += `<line x1="${ML - 5}" y1="${py}" x2="${ML}" y2="${py}" stroke="#555" stroke-width="1"/>`;
      s += `<text x="${ML - 7}" y="${py}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="#444">${lbl}</text>`;
    }
    for (const yv of yMinor) {
      const sv = toSVG(0.01, yv);
      if (!sv) continue;
      s += `<line x1="${ML - 3}" y1="${sv[1].toFixed(1)}" x2="${ML}" y2="${sv[1].toFixed(1)}" stroke="#888" stroke-width="0.8"/>`;
    }
    const cx = ((ML + MR) / 2).toFixed(1);
    const cy = ((MT + MB) / 2).toFixed(1);
    s += `<text x="${cx}" y="${VH - 3}" text-anchor="middle" font-size="12" font-style="italic" fill="#333">d / gT²</text>`;
    s += `<text x="13" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-style="italic" fill="#333" transform="rotate(-90,13,${cy})">H / gT²</text>`;
    return s;
  }

  // Region text labels
  function regionLabels() {
    const labels = [
      [0.07, 6e-5,  'Linear (Airy)'],
      [0.07, 3e-4,  'Stokes 2ⁿᵈ'],
      [0.07, 2e-3,  'Stokes 3ʳᵈ'],
      [0.07, 1.2e-2,'Stokes 4ᵗʰ'],
      [0.004, 5e-4, 'Cnoidal'],
      [0.0015,8e-4, 'Solitary'],
      [0.015, 0.03, 'Breaking'],
    ];
    let s = `<g clip-path="url(#plot-clip)" font-size="10" fill="#333" font-style="italic" text-anchor="middle" dominant-baseline="middle">`;
    for (const [xv, yv, txt] of labels) {
      const sv = toSVG(xv, yv);
      if (!sv) continue;
      s += `<text x="${sv[0].toFixed(1)}" y="${sv[1].toFixed(1)}">${txt}</text>`;
    }
    s += `</g>`;
    return s;
  }

  // Legend
  function legend() {
    const items = [
      ['#c62828', '',    'Miche (1951) breaking'],
      ['#e65100', '6,3', 'McCowan  H/d = 0.78'],
      ['#6a1b9a', '5,3', 'Cnoidal / Solitary  y = 0.45x'],
      ['#1565c0', '4,3', 'Linear / Stokes 2ⁿᵈ  (Uᵣ = 1)'],
      ['#2e7d32', '4,3', 'Stokes 2ⁿᵈ / 3ʳᵈ  (Uᵣ ≈ 3.2)'],
      ['#ad1457', '4,3', 'Stokes 3ʳᵈ / V  (Uᵣ ≈ 8.9)'],
    ];
    const LX = ML + 5, LY = MT + 8;
    const LW = 200, LH = items.length * 14 + 8;
    let s = `<rect x="${LX - 3}" y="${LY - 5}" width="${LW}" height="${LH}" fill="white" fill-opacity="0.90" rx="3" stroke="#ddd" stroke-width="0.5"/>`;
    items.forEach(([color, dash, lbl], i) => {
      const ly = LY + 8 + i * 14;
      const da = dash ? `stroke-dasharray="${dash}"` : '';
      s += `<line x1="${LX}" y1="${ly}" x2="${LX + 20}" y2="${ly}" stroke="${color}" stroke-width="1.8" ${da}/>`;
      s += `<text x="${LX + 24}" y="${ly}" dominant-baseline="middle" font-size="9" fill="#333">${lbl}</text>`;
    });
    return s;
  }

  // User wave dot and crosshairs
  function userDot() {
    if (!userX || !userY) return '';
    const sv = toSVG(userX, userY);
    if (!sv) return '';
    const [ux, uy] = [sv[0].toFixed(1), sv[1].toFixed(1)];
    const color = THEORY_COLORS[theory] || '#333';
    return `<g clip-path="url(#plot-clip)">
      <line x1="${ux}" y1="${MT}" x2="${ux}" y2="${MB}" stroke="${color}" stroke-width="0.9" stroke-dasharray="3,3" opacity="0.65"/>
      <line x1="${ML}" y1="${uy}" x2="${MR}" y2="${uy}" stroke="${color}" stroke-width="0.9" stroke-dasharray="3,3" opacity="0.65"/>
      <circle cx="${ux}" cy="${uy}" r="7" fill="${color}" stroke="#fff" stroke-width="2.5"/>
    </g>`;
  }

  function border() {
    return `<rect x="${ML}" y="${MT}" width="${PW}" height="${PH}" fill="none" stroke="#555" stroke-width="1.5"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Le Méhaut wave theory applicability diagram">
  <defs>
    <clipPath id="plot-clip">
      <rect x="${ML}" y="${MT}" width="${PW}" height="${PH}"/>
    </clipPath>
  </defs>
  <rect x="${ML}" y="${MT}" width="${PW}" height="${PH}" fill="#fff"/>
  ${linearFill()}
  ${cnoidalFill()}
  ${breakingPolygon()}
  ${grid()}
  ${makeCurve(michePts,   '#c62828', '',    1.8)}
  ${makeCurve(mccowanPts, '#e65100', '6,3', 1.5)}
  ${makeCurve(solCnPts,   '#6a1b9a', '5,3', 1.5)}
  ${makeCurve(linSt2Pts,  '#1565c0', '4,3', 1.3)}
  ${makeCurve(st23Pts,    '#2e7d32', '4,3', 1.3)}
  ${makeCurve(st34Pts,    '#ad1457', '4,3', 1.3)}
  ${depthLines()}
  ${axes()}
  ${regionLabels()}
  ${legend()}
  ${userDot()}
  ${border()}
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
