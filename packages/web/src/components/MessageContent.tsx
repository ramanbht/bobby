import { lazy, Suspense, type ReactNode } from "react";
import { ChartWidget } from "./widgets/ChartWidget.js";

const MermaidWidget = lazy(() =>
  import("./widgets/MermaidWidget.js").then((m) => ({ default: m.MermaidWidget })),
);

/**
 * Renders an assistant/user message as rich content: fenced ```chart and
 * ```mermaid blocks become visualizations, markdown tables become styled
 * tables, other fences become code blocks, and prose gets inline markdown.
 */
export function MessageContent({ text }: { text: string }) {
  if (!text) return null;
  return <div className="msg-content">{renderSegments(text)}</div>;
}

type Seg = { kind: "fence"; lang: string; code: string } | { kind: "text"; text: string };

function splitFences(text: string): Seg[] {
  const segs: Seg[] = [];
  const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) segs.push({ kind: "text", text: text.slice(last, m.index) });
    segs.push({ kind: "fence", lang: (m[1] || "").trim().toLowerCase(), code: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ kind: "text", text: text.slice(last) });
  return segs;
}

function renderSegments(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  splitFences(text).forEach((seg, i) => {
    if (seg.kind === "fence") {
      if (seg.lang === "mermaid") {
        out.push(
          <Suspense key={i} fallback={<div className="widget-loading">rendering diagram…</div>}>
            <MermaidWidget code={seg.code} />
          </Suspense>,
        );
      } else if (seg.lang === "chart" || seg.lang === "bobby-chart") {
        out.push(<ChartWidget key={i} raw={seg.code} />);
      } else {
        out.push(
          <pre key={i} className="code-block">
            {seg.lang && <span className="code-lang">{seg.lang}</span>}
            <code>{seg.code.replace(/\n$/, "")}</code>
          </pre>,
        );
      }
    } else {
      renderTextBlock(seg.text, `t${i}`, out);
    }
  });
  return out;
}

const isTableSep = (l: string) => l.includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(l);

function renderTextBlock(text: string, key: string, out: ReactNode[]): void {
  const lines = text.split("\n");
  let buf: string[] = [];
  let n = 0;

  const flushProse = () => {
    if (buf.join("").trim()) {
      out.push(
        <span key={`${key}-p${n++}`} className="prose">
          {renderInline(buf.join("\n"))}
        </span>,
      );
    }
    buf = [];
  };

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const sep = lines[i + 1] ?? "";
    if (line.includes("|") && isTableSep(sep)) {
      flushProse();
      const header = line;
      let j = i + 2;
      const body: string[] = [];
      while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
        body.push(lines[j]);
        j++;
      }
      out.push(<TableWidget key={`${key}-tbl${n++}`} header={header} body={body} />);
      i = j;
    } else {
      buf.push(line);
      i++;
    }
  }
  flushProse();
}

function cells(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}

function TableWidget({ header, body }: { header: string; body: string[] }) {
  const heads = cells(header);
  return (
    <div className="table-wrap">
      <table className="md-table">
        <thead>
          <tr>{heads.map((h, i) => <th key={i}>{renderInline(h)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, r) => {
            const cs = cells(row);
            return <tr key={r}>{heads.map((_, c) => <td key={c}>{renderInline(cs[c] ?? "")}</td>)}</tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Inline markdown: **bold**, *italic*, `code`. Newlines/lists preserved by the
 *  parent's `white-space: pre-wrap`. */
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) nodes.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) nodes.push(<code key={k++} className="inline-code">{tok.slice(1, -1)}</code>);
    else nodes.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
