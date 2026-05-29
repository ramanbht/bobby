/** Dependency-free SVG charts (bar / line / pie) from a small JSON spec.
 *  Authors emit a ```chart fenced block whose body is JSON like:
 *    { "type": "bar", "title": "Revenue", "labels": ["Q1","Q2"],
 *      "series": [{ "name": "2025", "data": [42, 55] }] }
 */
interface Series {
  name?: string;
  data: number[];
}
interface ChartSpec {
  type?: "bar" | "line" | "pie";
  title?: string;
  labels?: string[];
  series?: Series[];
  data?: number[];
}

const PALETTE = ["#a855f7", "#7c3aed", "#c084fc", "#8b5cf6", "#d8b4fe", "#9333ea"];
const W = 600;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 34, left: 40 };

export function ChartWidget({ raw }: { raw: string }) {
  let spec: ChartSpec;
  try {
    spec = JSON.parse(raw);
  } catch {
    return <ChartError raw={raw} />;
  }
  const series = spec.series ?? (spec.data ? [{ data: spec.data }] : []);
  if (!series.length || !series[0].data?.length) return <ChartError raw={raw} />;
  const labels = spec.labels ?? series[0].data.map((_, i) => String(i + 1));
  const type = spec.type ?? "bar";

  return (
    <figure className="chart-widget">
      {spec.title && <figcaption className="chart-title">{spec.title}</figcaption>}
      {type === "pie" ? (
        <PieChart labels={labels} data={series[0].data} />
      ) : type === "line" ? (
        <LineChart labels={labels} series={series} />
      ) : (
        <BarChart labels={labels} series={series} />
      )}
      {(type !== "pie" && series.length > 1) || type === "pie" ? (
        <Legend names={type === "pie" ? labels : series.map((s, i) => s.name ?? `Series ${i + 1}`)} />
      ) : null}
    </figure>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function Axis({ max }: { max: number }) {
  const ticks = 4;
  const innerH = H - PAD.top - PAD.bottom;
  return (
    <g className="chart-axis">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const y = PAD.top + (innerH * i) / ticks;
        const val = Math.round(max - (max * i) / ticks);
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} />
            <text x={PAD.left - 6} y={y + 3} textAnchor="end">{val}</text>
          </g>
        );
      })}
    </g>
  );
}

function BarChart({ labels, series }: { labels: string[]; series: Series[] }) {
  const max = niceMax(Math.max(...series.flatMap((s) => s.data)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const groups = labels.length;
  const groupW = innerW / groups;
  const barW = (groupW * 0.7) / series.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img">
      <Axis max={max} />
      {labels.map((label, gi) => {
        const gx = PAD.left + groupW * gi + groupW * 0.15;
        return (
          <g key={gi}>
            {series.map((s, si) => {
              const v = s.data[gi] ?? 0;
              const h = (v / max) * innerH;
              return (
                <rect
                  key={si}
                  x={gx + barW * si}
                  y={PAD.top + innerH - h}
                  width={barW - 2}
                  height={Math.max(0, h)}
                  rx={2}
                  fill={PALETTE[si % PALETTE.length]}
                />
              );
            })}
            <text x={PAD.left + groupW * gi + groupW / 2} y={H - PAD.bottom + 16} textAnchor="middle" className="chart-label">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ labels, series }: { labels: string[]; series: Series[] }) {
  const max = niceMax(Math.max(...series.flatMap((s) => s.data)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = labels.length;
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img">
      <Axis max={max} />
      {series.map((s, si) => {
        const color = PALETTE[si % PALETTE.length];
        const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        return (
          <g key={si}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {s.data.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={color} />
            ))}
          </g>
        );
      })}
      {labels.map((label, i) => (
        <text key={i} x={x(i)} y={H - PAD.bottom + 16} textAnchor="middle" className="chart-label">
          {label}
        </text>
      ))}
    </svg>
  );
}

function PieChart({ labels, data }: { labels: string[]; data: number[] }) {
  const total = data.reduce((a, b) => a + b, 0) || 1;
  const cx = H / 2;
  const cy = H / 2;
  const r = H / 2 - PAD.top;
  let angle = -Math.PI / 2;

  return (
    <svg viewBox={`0 0 ${H} ${H}`} className="chart-svg chart-pie" role="img">
      {data.map((v, i) => {
        const slice = (v / total) * Math.PI * 2;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        angle += slice;
        const x2 = cx + r * Math.cos(angle);
        const y2 = cy + r * Math.sin(angle);
        const large = slice > Math.PI ? 1 : 0;
        const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
        return <path key={i} d={d} fill={PALETTE[i % PALETTE.length]} stroke="#140a22" strokeWidth={1.5} />;
      })}
    </svg>
  );
}

function Legend({ names }: { names: string[] }) {
  return (
    <div className="chart-legend">
      {names.map((name, i) => (
        <span key={i} className="legend-item">
          <span className="legend-swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
          {name}
        </span>
      ))}
    </div>
  );
}

function ChartError({ raw }: { raw: string }) {
  return (
    <div className="widget-error">
      <span>⚠ couldn't render chart</span>
      <pre className="code-block">
        <code>{raw.trim()}</code>
      </pre>
    </div>
  );
}
