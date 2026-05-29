import { useEffect, useRef, useState } from "react";

let initialized = false;

/** Renders a ```mermaid block as an SVG diagram. Mermaid is loaded lazily so it
 *  never bloats the initial bundle. */
export function MermaidWidget({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const id = useRef(`mmd-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!initialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "dark",
            securityLevel: "strict",
            themeVariables: {
              primaryColor: "#2a1148",
              primaryBorderColor: "#7c3aed",
              primaryTextColor: "#e9e3f5",
              lineColor: "#a855f7",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
            },
          });
          initialized = true;
        }
        const { svg } = await mermaid.render(id, code.trim());
        if (!cancelled) setSvg(svg);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (err)
    return (
      <div className="widget-error">
        <span>⚠ couldn't render diagram</span>
        <pre className="code-block">
          <code>{code.trim()}</code>
        </pre>
      </div>
    );
  if (!svg) return <div className="widget-loading">rendering diagram…</div>;
  return <div className="mermaid-widget" dangerouslySetInnerHTML={{ __html: svg }} />;
}
