// The view: pixels and gestures only. It never decides legality (js/core/game.js does) and
// never classifies a position (js/core/book.js does) — the three layers stay apart so a
// `node --test` run can import the rules without a DOM.
//
// Everything drawn here is procedural: cocoa gradients, bevels, scored grooves and a path-drawn
// skull for the poisoned square. No image, no font file, no audio asset.
//
// Coordinate contract with the harness: `cellPoint(r, c)` and `previewPoint()` return CLIENT
// coordinates (canvas rect included), which is exactly what CDP's `Input.dispatchMouseEvent`
// wants. `pointAt(x, y)` is the inverse and takes client coordinates too. If those two ever
// disagree by even the canvas offset, the browser suite clicks empty space and the click is
// correctly refused — which is why the @pointer suite exists.

import { area, applyBite, encodeShape, legalBites } from './core/shapes.js';

const GAP = 3;            // px between squares, the scored groove of the bar
const PAD = 14;           // px of wrapper around the bar
const MIN_CELL = 26;
const MAX_CELL = 62;

export function createView(canvas, getState) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let cell = MIN_CELL;
  let originX = PAD;
  let originY = PAD;

  function grid() {
    const st = getState();
    const shape = st.shape.length ? st.shape : st.root;
    const rows = st.root.length;
    const cols = st.root[0];
    return { shape, rows, cols };
  }

  // Fit the BAR (the original outline, not the leftovers) into the canvas, so bitten squares
  // leave holes instead of the whole picture sliding around under the finger.
  function layout() {
    const { rows, cols } = grid();
    const availW = cssW - PAD * 2;
    const availH = cssH - PAD * 2;
    cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(Math.min(
      (availW - GAP * (cols - 1)) / cols,
      (availH - GAP * (rows - 1)) / rows,
    ))));
    originX = Math.round((cssW - (cols * cell + (cols - 1) * GAP)) / 2);
    originY = Math.round((cssH - (rows * cell + (rows - 1) * GAP)) / 2);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    cssW = Math.max(60, Math.round(rect.width));
    cssH = Math.max(60, Math.round(rect.height));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
    draw();
  }

  // ---- geometry -------------------------------------------------------------
  function squareRect(r, c) {
    return {
      x: originX + c * (cell + GAP),
      y: originY + r * (cell + GAP),
      w: cell,
      h: cell,
    };
  }

  // Client coords of the centre of square (r,c) — what the harness clicks.
  function cellPoint(r, c) {
    const rect = canvas.getBoundingClientRect();
    const q = squareRect(r, c);
    return { x: Math.round(rect.left + q.x + q.w / 2), y: Math.round(rect.top + q.y + q.h / 2) };
  }

  // Inverse: which square is under this client point? `null` when the point is not on the bar
  // outline at all (dead canvas space, wrapper, or outside the element).
  function pointAt(x, y) {
    const rect = canvas.getBoundingClientRect();
    const lx = x - rect.left;
    const ly = y - rect.top;
    const { rows, cols } = grid();
    const c = Math.floor((lx - originX + GAP) / (cell + GAP));
    const r = Math.floor((ly - originY + GAP) / (cell + GAP));
    if (r < 0 || c < 0 || r >= rows || c >= cols) return null;
    return { r, c };
  }

  // Clamp a client point to the nearest square that still exists on the bar. Dragging off an
  // edge must stick to the boundary instead of dropping the gesture — the @pointer suite asserts
  // this ("过拉钳制在边界"), because a silent drop looks exactly like an ignored finger.
  function clampToBar(x, y) {
    const hit = pointAt(x, y) || { r: 0, c: 0 };
    const st = getState();
    const shape = st.shape;
    let r = Math.max(0, Math.min(shape.length - 1, hit.r));
    let c = Math.max(0, Math.min((shape[r] || 1) - 1, hit.c));
    // A row that has been bitten away entirely has no square to land on: walk up to the
    // deepest row that still has the requested column, else the last row's last square.
    if (!shape[r] || c >= shape[r]) {
      for (let i = shape.length - 1; i >= 0; i--) {
        if (shape[i] > 0) {
          r = i;
          c = Math.max(0, Math.min(shape[i] - 1, hit.c));
          break;
        }
      }
    }
    return { r, c };
  }

  // ---- painting -------------------------------------------------------------
  function roundRect(x, y, w, h, rad) {
    const k = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + w - k, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + k);
    ctx.lineTo(x + w, y + h - k);
    ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
    ctx.lineTo(x + k, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - k);
    ctx.lineTo(x, y + k);
    ctx.quadraticCurveTo(x, y, x + k, y);
    ctx.closePath();
  }

  function chocolate(x, y, w, h, tone) {
    const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
    g.addColorStop(0, tone ? '#7d4f2c' : '#8a5733');
    g.addColorStop(0.5, tone ? '#5f381d' : '#6d4022');
    g.addColorStop(1, tone ? '#492814' : '#54301a');
    roundRect(x, y, w, h, Math.max(3, w * 0.14));
    ctx.fillStyle = g;
    ctx.fill();
    // bevel: light top-left edge, dark bottom-right — the pressed-cocoa highlight
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,226,180,0.30)';
    ctx.beginPath();
    ctx.moveTo(x + 2, y + h - 3);
    ctx.lineTo(x + 2, y + 2);
    ctx.lineTo(x + w - 3, y + 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,12,4,0.55)';
    ctx.beginPath();
    ctx.moveTo(x + w - 2, y + 3);
    ctx.lineTo(x + w - 2, y + h - 2);
    ctx.lineTo(x + 3, y + h - 2);
    ctx.stroke();
  }

  function skull(x, y, s) {
    // Path-drawn, no font: a skull that reads at 20 px and at 60 px.
    const cx = x + s / 2;
    const cy = y + s * 0.44;
    const r = s * 0.26;
    ctx.fillStyle = '#c9f2a0';
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.lineTo(cx + r, cy + r * 0.55);
    ctx.quadraticCurveTo(cx + r * 0.55, cy + r * 1.25, cx, cy + r * 1.25);
    ctx.quadraticCurveTo(cx - r * 0.55, cy + r * 1.25, cx - r, cy + r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2f4a1c';
    const eye = r * 0.3;
    ctx.beginPath();
    ctx.arc(cx - r * 0.42, cy - r * 0.05, eye, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.42, cy - r * 0.05, eye, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.18);
    ctx.lineTo(cx - eye * 0.7, cy + r * 0.72);
    ctx.lineTo(cx + eye * 0.7, cy + r * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c9f2a0';
    for (let i = -1; i <= 1; i++) {
      roundRect(cx + i * r * 0.42 - r * 0.12, cy + r * 1.0, r * 0.24, r * 0.5, r * 0.1);
      ctx.fill();
    }
  }

  function ghost(x, y, w, h) {
    // A bitten-away square: the wrapper shows through, with a scalloped bite edge.
    ctx.save();
    ctx.globalAlpha = 0.5;
    roundRect(x + 3, y + 3, w - 6, h - 6, Math.max(4, w * 0.2));
    ctx.fillStyle = '#2b1a10';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,80,50,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    const st = getState();
    const { shape, rows, cols } = grid();
    ctx.clearRect(0, 0, cssW, cssH);

    // the wrapper / foil tray
    const w = cols * cell + (cols - 1) * GAP;
    const h = rows * cell + (rows - 1) * GAP;
    roundRect(originX - 7, originY - 7, w + 14, h + 14, 12);
    ctx.fillStyle = '#3a2415';
    ctx.fill();
    ctx.strokeStyle = 'rgba(210,170,120,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // the bite preview: the whole quadrant below-and-right of the anchored square
    const prev = st.preview;
    if (prev) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,120,90,0.26)';
      for (let r = prev.r; r < shape.length; r++) {
        for (let c = prev.c; c < shape[r]; c++) {
          if (c < prev.c) continue;
          const q = squareRect(r, c);
          roundRect(q.x, q.y, q.w, q.h, Math.max(3, q.w * 0.14));
          ctx.fill();
        }
      }
      const q = squareRect(prev.r, prev.c);
      ctx.strokeStyle = 'rgba(255,150,110,0.9)';
      ctx.lineWidth = 2;
      roundRect(q.x - 1, q.y - 1, q.w + 2, q.h + 2, Math.max(4, q.w * 0.16));
      ctx.stroke();
      ctx.restore();
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const q = squareRect(r, c);
        const alive = r < shape.length && c < shape[r];
        if (!alive) {
          ghost(q.x, q.y, q.w, q.h);
          continue;
        }
        const poison = r === 0 && c === 0;
        chocolate(q.x, q.y, q.w, q.h, poison);
        if (poison) {
          ctx.save();
          ctx.fillStyle = 'rgba(180,255,140,0.16)';
          roundRect(q.x, q.y, q.w, q.h, Math.max(3, q.w * 0.14));
          ctx.fill();
          skull(q.x, q.y, q.w);
          ctx.restore();
        }
      }
    }

    // the last bite: outline what just vanished, so the answer to "what did the AI take" is
    // visible without reading the text line
    if (st.lastBite && st.lastBite.gone) {
      ctx.save();
      ctx.strokeStyle = st.lastBite.seat === 'you' ? 'rgba(150,220,255,0.75)' : 'rgba(255,140,120,0.8)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      for (const [r, c] of st.lastBite.gone) {
        const q = squareRect(r, c);
        roundRect(q.x + 1, q.y + 1, q.w - 2, q.h - 2, Math.max(3, q.w * 0.14));
        ctx.stroke();
      }
      ctx.restore();
    }

    // ruler: row / column numbers, because the hint and the panel speak in 1-based coordinates
    ctx.save();
    ctx.fillStyle = 'rgba(230,200,170,0.55)';
    ctx.font = `${Math.max(9, Math.round(cell * 0.28))}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < cols; c++) {
      const q = squareRect(0, c);
      ctx.fillText(String(c + 1), q.x + q.w / 2, originY - 14);
    }
    ctx.textAlign = 'right';
    for (let r = 0; r < rows; r++) {
      const q = squareRect(r, 0);
      ctx.fillText(String(r + 1), originX - 8, q.y + q.h / 2);
    }
    ctx.restore();

    // remaining count, printed on the tray
    ctx.save();
    ctx.fillStyle = 'rgba(240,215,185,0.75)';
    ctx.font = `${Math.max(11, Math.round(cell * 0.34))}px ui-monospace, SFMono-Regular, monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(`${area(shape)} 格`, originX, originY + h + 16);
    ctx.restore();
  }

  // Where the preview anchor sits in client space (the harness asks for it instead of guessing
  // a pixel that happens to be over the square it means).
  function previewPoint() {
    const st = getState();
    if (!st.preview) return null;
    return cellPoint(st.preview.r, st.preview.c);
  }

  // The squares a bite at (r,c) removes from the CURRENT bar — the view draws exactly what the
  // rules will bill, no more (see the @pointer assertion on the footprint).
  function goneSquares(shape, r, c) {
    const before = new Set();
    for (let i = 0; i < shape.length; i++) for (let j = 0; j < shape[i]; j++) before.add(i + '.' + j);
    const next = applyBite(shape, [r, c]);
    const after = new Set();
    for (let i = 0; i < next.length; i++) for (let j = 0; j < next[i]; j++) after.add(i + '.' + j);
    return [...before].filter((k) => !after.has(k)).map((k) => k.split('.').map(Number));
  }

  return {
    resize,
    draw,
    layout,
    cellPoint,
    pointAt,
    clampToBar,
    previewPoint,
    squareRect,
    goneSquares,
    legalTargets: () => legalBites(getState().shape).map(([r, c]) => ({ r, c })),
    metrics: () => ({ cell, originX, originY, gap: GAP, pad: PAD, dpr, cssW, cssH, key: encodeShape(getState().shape) }),
  };
}
