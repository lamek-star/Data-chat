// Small, dependency-free charts for the admin dashboard (SVG). Each animates
// in once and respects "reduce motion".
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts up to `value` once it changes. */
export function CountUp({ value, duration = 900, format = (n) => n.toLocaleString() }) {
  const [shown, setShown] = useState(reducedMotion() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reducedMotion()) return setShown(value);
    const start = performance.now();
    const begin = from.current;
    let frame;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(begin + (value - begin) * eased));
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <>{format(shown)}</>;
}

/**
 * Smooth path through points that never overshoots (monotone cubic,
 * Fritsch-Carlson): a flat stretch stays flat and no curve dips below zero.
 */
function smoothPath(points) {
  const n = points.length;
  if (n < 2) return "";
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const m = [];
  for (let i = 0; i < n - 1; i++) m.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1));
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const sum = a * a + b * b;
    if (sum > 9) {
      const tau = 3 / Math.sqrt(sum);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }
  let d = `M${xs[0]},${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    d += ` C${xs[i] + dx},${ys[i] + t[i] * dx} ${xs[i + 1] - dx},${ys[i + 1] - t[i + 1] * dx} ${xs[i + 1]},${ys[i + 1]}`;
  }
  return d;
}

const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Area chart with a comparison line. `series` = [{ start, count }],
 * `compare` (optional) = same length, drawn dashed.
 */
export function AreaChart({ series, compare, label = "Sign-ups", compareLabel, height = 220 }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState(null);
  const lineRef = useRef(null);
  const width = 640;
  const pad = { top: 18, right: 12, bottom: 28, left: 34 };
  const max = Math.max(4, ...series.map((s) => s.count), ...(compare || []).map((s) => s.count));
  const niceMax = Math.ceil(max / 4) * 4;
  const x = (i) => pad.left + (i * (width - pad.left - pad.right)) / Math.max(1, series.length - 1);
  const y = (v) => pad.top + (1 - v / niceMax) * (height - pad.top - pad.bottom);
  const pts = series.map((s, i) => [x(i), y(s.count)]);
  const line = smoothPath(pts);
  const area = `${line} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const comparePath = compare ? smoothPath(compare.map((s, i) => [x(i), y(s.count)])) : "";
  const ticks = [0, niceMax / 4, niceMax / 2, (3 * niceMax) / 4, niceMax];
  // Draw the line in: dash it to its real length, then slide the dash away.
  useLayoutEffect(() => {
    const el = lineRef.current;
    if (!el || reducedMotion()) return;
    const length = el.getTotalLength();
    el.style.transition = "none";
    el.style.strokeDasharray = `${length}`;
    el.style.strokeDashoffset = `${length}`;
    el.getBoundingClientRect(); // apply before animating
    el.style.transition = "stroke-dashoffset 1300ms cubic-bezier(0.22, 1, 0.36, 1) 120ms";
    el.style.strokeDashoffset = "0";
  }, [line]);
  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const i = Math.round(((px - pad.left) / (width - pad.left - pad.right)) * (series.length - 1));
    setHover(Math.max(0, Math.min(series.length - 1, i)));
  };
  return (
    <div className="ad-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} over the last ${series.length} periods`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--ad-accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--ad-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="ad-grid" />
            <text x={pad.left - 8} y={y(t) + 4} className="ad-axis" textAnchor="end">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {series.map((s, i) =>
          i % 2 === 0 || series.length < 8 ? (
            <text key={s.start} x={x(i)} y={height - 8} className="ad-axis" textAnchor="middle">
              {shortDate(s.start)}
            </text>
          ) : null,
        )}
        <path d={area} fill={`url(#fill-${id})`} className="ad-area" />
        {comparePath && <path d={comparePath} className="ad-compare" />}
        <path ref={lineRef} d={line} className="ad-line" />
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={y(0)} className="ad-cursor" />
            <circle cx={x(hover)} cy={y(series[hover].count)} r="5" className="ad-dot" />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="ad-tooltip" style={{ left: `${(x(hover) / width) * 100}%` }}>
          <b>{series[hover].count.toLocaleString()}</b> {label.toLowerCase()}
          {compare && (
            <span>
              {compare[hover].count.toLocaleString()} {compareLabel?.toLowerCase()}
            </span>
          )}
          <small>Week of {shortDate(series[hover].start)}</small>
        </div>
      )}
    </div>
  );
}

/** Vertical columns that fill up (e.g. messages per day). */
export function ColumnChart({ series, label }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  const [ready, setReady] = useState(reducedMotion());
  useEffect(() => {
    const t = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(t);
  }, []);
  return (
    <div className="ad-columns" role="img" aria-label={`${label}: ${series.map((s) => s.count).join(", ")}`}>
      {series.map((s, i) => (
        <div key={s.start} className="ad-column" title={`${shortDate(s.start)}: ${s.count.toLocaleString()}`}>
          <span style={{ height: ready ? `${Math.max(4, (s.count / max) * 100)}%` : "4%", transitionDelay: `${i * 35}ms` }} />
        </div>
      ))}
    </div>
  );
}

/** One bar split into coloured segments with a legend underneath. */
export function SegmentBar({ parts }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1;
  const visible = useMemo(() => parts.filter((p) => p.value > 0), [parts]);
  return (
    <div className="ad-segments">
      <div className="ad-segment-bar">
        {visible.map((p) => (
          <span key={p.label} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />
        ))}
        {!visible.length && <span style={{ flexGrow: 1 }} className="ad-segment-empty" />}
      </div>
      <div className="ad-legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label}
            <b>{Math.round((p.value / total) * 100)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}
