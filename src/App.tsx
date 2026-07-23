import { useState } from 'react';
import wordmark from './assets/copo-watermark.png';
import logo from './assets/emergence-logo.png';
import RootBrush from './tools/RootBrush';
import FlowField from './tools/FlowField';
import Jagged from './tools/Jagged';
import Contour from './tools/Contour';
import RoadColors from './tools/RoadColors';
import RootsText from './tools/RootsText';

// Host for active-tool controls — they portal into the mode-rail panel under the
// Branch/Field (and brush/tool) toggles so nav + settings read as one unit.

interface ToolDef {
  id: string;
  label: string;
  Component: (props: { controlsTarget?: HTMLElement | null }) => React.ReactNode;
}

const TOOLS: ToolDef[] = [
  { id: 'root-brush', label: 'Root Brush', Component: RootBrush },
  { id: 'flow-field', label: 'Fingerprint', Component: FlowField },
  { id: 'jagged', label: 'Jagged Fingerprint', Component: Jagged },
  { id: 'contour', label: 'Contour', Component: Contour },
  { id: 'road-colors', label: 'Map', Component: RoadColors },
  { id: 'roots-text', label: 'Roots + Text', Component: RootsText },
];

type Family = 'branch' | 'field';
type Brush = 'organic' | 'engineered';
type Style = 'abstract' | 'topographic';

/** Field tools by brush × style. */
const FIELD_TOOL: Record<Brush, Record<Style, string>> = {
  organic: { abstract: 'flow-field', topographic: 'contour' },
  engineered: { abstract: 'jagged', topographic: 'road-colors' },
};

export default function App() {
  // Nested-toggle nav. Branch/Field × Organic/Engineered × Abstract/Topographic.
  // Branch is Organic-only — the Brush toggle shows only in Field mode.
  const [family, setFamily] = useState<Family>('branch');
  const [brush, setBrush] = useState<Brush>('organic');
  const [style, setStyle] = useState<Style>('abstract');
  const [toolControlsHost, setToolControlsHost] = useState<HTMLElement | null>(null);

  const withToolPanel = family === 'branch' || family === 'field';

  // Resolve the nav state to the active tool.
  const activeId = (() => {
    if (family === 'field') return FIELD_TOOL[brush][style];
    return 'root-brush';
  })();
  const active = TOOLS.find((t) => t.id === activeId) ?? TOOLS[0];
  const Active = active.Component;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <img
            src={logo}
            alt="Emergence"
            className="app-header__logo"
          />
        </div>
      </header>

      <div className="app-body">
        <aside
          className={`mode-rail${withToolPanel ? ' mode-rail--with-tool' : ''}`}
          aria-label="Mode"
        >
          {withToolPanel && (
            <div className="mode-rail__panel mode-rail__panel--tool">
              <div className="mode-rail__group">
                <span className="mode-rail__label">Mode</span>
                <div className="seg" role="group" aria-label="Branch or field">
                  {(['branch', 'field'] as Family[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`seg__opt${f === family ? ' seg__opt--active' : ''}`}
                      aria-pressed={f === family}
                      onClick={() => setFamily(f)}
                    >
                      {f === 'branch' ? 'Branch' : 'Field'}
                    </button>
                  ))}
                </div>
              </div>

              {family === 'field' && (
                <div className="mode-rail__group">
                  <span className="mode-rail__label">Brush</span>
                  <div className="seg seg--alt" role="group" aria-label="Brush">
                    {(['organic', 'engineered'] as Brush[]).map((b) => (
                      <button
                        key={b}
                        type="button"
                        className={`seg__opt${b === brush ? ' seg__opt--active' : ''}`}
                        aria-pressed={b === brush}
                        onClick={() => setBrush(b)}
                      >
                        {b === 'organic' ? 'Organic' : 'Engineered'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {family === 'field' && (
                <div className="mode-rail__group">
                  <div className="seg seg--alt" role="group" aria-label="Style">
                    {(['abstract', 'topographic'] as Style[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`seg__opt${s === style ? ' seg__opt--active' : ''}`}
                        aria-pressed={s === style}
                        onClick={() => setStyle(s)}
                      >
                        {s === 'abstract' ? 'Abstract' : 'Topographic'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Active tool sliders / actions land here via portal. */}
              <div
                ref={setToolControlsHost}
                className="mode-rail__tool-controls"
              />
            </div>
          )}
        </aside>

        <main className="app-main">
          {/* Remount on tool change so each engine resets its canvas/state cleanly.
              Root Brush is always Organic (Branch has no Engineered brush). */}
          {active.id === 'root-brush' ? (
            <RootBrush
              key="root-brush"
              brush="organic"
              hideBrushToggle
              controlsTarget={toolControlsHost}
            />
          ) : active.id === 'road-colors' ? (
            <RoadColors key="road-colors" controlsTarget={toolControlsHost} />
          ) : (
            <Active key={active.id} controlsTarget={toolControlsHost} />
          )}
        </main>
      </div>

      <footer className="app-footer">
        <p className="app-footer__credit">
          Created by
          <img src={wordmark} alt="Company Policy" className="app-footer__wordmark" />
        </p>
      </footer>
    </div>
  );
}
