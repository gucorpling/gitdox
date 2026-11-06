/*
* @file RstWeb: RST / eRST discourse tree editor over SocialCalc columns (port of legacy rstWeb)
*/

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Undo2, Redo2, Highlighter, EyeOff, Upload, Download } from 'lucide-react';
import { parseSocialCalc, serializeSocialCalc, withWords } from './rstweb/rst-io';
import { parseRs4, serializeRs4, fitRs4Import } from './rstweb/rs4';
import { normalizeRstConfig } from './rstweb/rst-config';
import { computeLayout } from './rstweb/rst-model';
import { buildEdgeSpecs, relationOptions, newSignal, signalColorIndex } from './rstweb/rst-edges';
import { createEdgeLayer } from './rstweb/edge-layer';
import { createRstState, makeRstReducer, canUndo, canRedo } from './rstweb/rst-state';
import SignalDrawer from './rstweb/SignalDrawer';
import './rstweb/rstweb.css';

/** Gray bands along the scrollable edges of the canvas, shown while dragging; holding the pointer in one scrolls that way */
function EdgeBands({ canvasRef }) {
  const [available, setAvailable] = useState([]);
  useEffect(() => {
    const update = () => {
      const c = canvasRef.current;
      if (!c) return;
      const next = [
        c.scrollLeft > 0 && 'left',
        c.scrollLeft + c.clientWidth < c.scrollWidth - 1 && 'right',
        c.scrollTop > 0 && 'top',
        c.scrollTop + c.clientHeight < c.scrollHeight - 1 && 'bottom'
      ].filter(Boolean);
      setAvailable((prev) => (prev.join() === next.join() ? prev : next));
    };
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [canvasRef]);
  const arrows = { left: '\u25c0', right: '\u25b6', top: '\u25b2', bottom: '\u25bc' };
  return available.map((side) => (
    <div key={side} className={`rstweb-edgeband rstweb-edgeband--${side}`} style={{ '--band': `${EDGE_BAND}px` }}>{arrows[side]}</div>
  ));
}

// Width (px) of the scroll bands along the canvas edges while dragging, and the top scroll speed (px per frame)
const EDGE_BAND = 48;
const EDGE_SPEED = 18;

function NodeButtons({ id, label, dispatch, onDragStart, onShowId, cfg }) {
  return (
    <table className="btn_tb">
      <tbody>
        <tr>
          <td rowSpan={cfg.disableMultinucs ? 1 : 2}><button type="button" title="unlink this node" className="minibtn" onClick={() => dispatch({ type: 'unlink', id })}>X</button></td>
          <td rowSpan={cfg.disableMultinucs ? 1 : 2}><span className="num_id" onPointerDown={(e) => onDragStart(e, id)} onDoubleClick={() => onShowId(id)}>{label}</span></td>
          {!cfg.disableSpans && (
            <td><button type="button" title="add span above" className="minibtn" onClick={() => dispatch({ type: 'insertSpan', id })}>T</button></td>
          )}
        </tr>
        {!cfg.disableMultinucs && (
          <tr>
            <td><button type="button" title="add multinuc above" className="minibtn" onClick={() => dispatch({ type: 'insertMultinuc', id })}>{'\u039b'}</button></td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Relation dropdown (with signal and unlink buttons where legacy had them) rendered on an edge */
const signalTarget = (edge) => (edge.kind === 'secedge' ? edge.target : undefined);
const signalsOf = (signals, edge) => signals.filter((s) => s.source === edge.source && s.target === signalTarget(edge));

function EdgeLabel({ edge, cfg, signals, dispatch, active, onSignals, onHover }) {
  const secondary = edge.kind === 'secedge';
  const options = relationOptions(cfg, edge.kind);
  if (edge.relname && !options.some((o) => o.value === edge.relname)) options.push({ value: edge.relname, label: edge.relname });
  const signalCount = signalsOf(signals, edge).length;
  const signalsEnabled = cfg.signalUi;

  return (
    <div
      className={active ? 'seldiv--active' : undefined}
      style={{ whiteSpace: 'nowrap' }}
      onMouseEnter={() => onHover(edge)}
      onMouseLeave={() => onHover(null)}
    >
      {signalsEnabled && (
        <button type="button" title="add signals" className={signalCount ? 'minibtn minibtn--with-signals' : 'minibtn'} onClick={() => onSignals(edge)}>
          {signalCount || 'S'}
        </button>
      )}
      {secondary && (
        <button type="button" title="unlink secondary edge" className="minibtn closer"
          onClick={() => dispatch({ type: 'removeSecedge', source: edge.source, target: edge.target })}>X</button>
      )}
      <select
        className="rst_rel"
        value={edge.relname ?? ''}
        style={secondary ? { color: 'blue', width: 50, height: 18 } : undefined}
        onChange={(e) => dispatch(secondary
          ? { type: 'setSecedgeRelation', source: edge.source, target: edge.target, relname: e.target.value }
          : { type: 'setRelation', id: edge.source, relname: e.target.value })}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

const buildParsed = (value, config) => {
  try {
    return { parsed: parseSocialCalc(value, config), error: null };
  } catch (err) {
    return { parsed: null, error: err.message };
  }
};

export default function RstWeb({ value, config, onChange, validation, className = '' }) {
  const cfg = useMemo(() => normalizeRstConfig(config), [config]);
  // Ids of nodes the backend's rst-domain validations flagged (lags edits slightly: validation is async)
  const invalid = useMemo(() => new Set(
    (validation?.results || []).filter((r) => r?.domain === 'rst').flatMap((r) => r.nodes || [])
  ), [validation]);
  const reducer = useMemo(() => makeRstReducer(cfg), [cfg]);
  const { parsed, error } = useMemo(() => buildParsed(value, config), [value, config]);

  // `source` is the serialized value the state corresponds to; a different incoming value (external edit) reloads it
  const [state, setState] = useState(() => ({ ...createRstState(parsed?.model ?? null), source: value }));
  let current = state;
  if (state.source !== value) {
    current = { ...createRstState(parsed?.model ?? null), source: value };
    setState(current);
  }

  const dispatch = useCallback((action) => {
    const next = reducer(current, action);
    if (next === current) return;
    if (next.present === current.present) {
      setState({ ...next, source: current.source });
      return;
    }
    const serialized = serializeSocialCalc(parsed.sheet, next.present, config);
    setState({ ...next, source: serialized });
    onChange?.(serialized);
  }, [reducer, current, parsed, config, onChange]);

  const model = current.present;
  const layout = useMemo(() => (model ? computeLayout(model, cfg) : null), [model, cfg]);
  const edges = useMemo(() => (model ? buildEdgeSpecs(model, cfg, layout) : []), [model, cfg, layout]);

  const [edgeLayer] = useState(createEdgeLayer);
  const { overlays } = useSyncExternalStore(edgeLayer.subscribe, edgeLayer.getSnapshot);
  const innerRef = useRef(null);
  const rootRef = useRef(null);
  const attachCanvas = useCallback((element) => {
    innerRef.current = element;
    if (element) edgeLayer.attach(element);
    else edgeLayer.detach();
  }, [edgeLayer]);
  useLayoutEffect(() => { edgeLayer.setEdges(edges); }, [edgeLayer, edges]);

  // Signals: the drawer edits those of one relation; hovering a relation, or "show all", highlights their words
  const signalsEnabled = cfg.signalUi;
  const [drawerState, setDrawer] = useState(null);
  // A drawer opened on an older value (the text was edited elsewhere meanwhile) is discarded
  const drawer = drawerState && drawerState.forSource === current.source ? drawerState : null;
  const [hover, setHover] = useState(null);
  // Signal colouring is on from the start when signals are in use
  const [showAll, setShowAll] = useState(cfg.signalUi);
  const [menu, setMenu] = useState(null);
  const drawerOpen = drawer !== null;
  useLayoutEffect(() => { edgeLayer.settle(); }, [edgeLayer, drawerOpen]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (!e.target.closest?.('.custom-menu')) setMenu(null); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const signals = model?.signals;
  const lastSignalType = useMemo(() => {
    const map = new Map();
    (signals || []).forEach((s) => s.tokens.forEach((t) => map.set(t, s.type)));
    return map;
  }, [signals]);
  const hoverTokens = useMemo(() => new Set(hover && signals ? signalsOf(signals, hover).flatMap((s) => s.tokens) : []), [hover, signals]);

  const openDrawer = useCallback((edge) => {
    const existing = signalsOf(model.signals, edge).map(({ type, subtype, tokens }) => ({ type, subtype, tokens: [...tokens] }));
    const list = existing.length ? existing : [newSignal(cfg)];
    setHover(null);
    setDrawer({ forSource: current.source, source: edge.source, target: signalTarget(edge), signals: list, selected: list.length - 1, pending: [], initial: JSON.stringify(existing) });
  }, [model, cfg, current.source]);

  const saveDrawer = () => {
    // Signals without words are kept: they describe the whole node (e.g. a document's layout)
    const cleaned = drawer.signals;
    if (JSON.stringify(cleaned) !== drawer.initial) dispatch({ type: 'setSignals', source: drawer.source, target: drawer.target, signals: cleaned });
    setDrawer(null);
  };
  const cancelDrawer = () => setDrawer(null);

  // Words are picked by clicking, or by dragging over them, into the selected signal (or the pending list if none is)
  const pickToken = (n, toggle) => setDrawer((d) => {
    const list = d.selected >= 0 ? d.signals[d.selected].tokens : d.pending;
    const has = list.includes(n);
    if (has && !toggle) return d;
    const next = has ? list.filter((t) => t !== n) : [...list, n];
    if (d.selected < 0) return { ...d, pending: next };
    return { ...d, signals: d.signals.map((s, i) => (i === d.selected ? { ...s, tokens: next } : s)) };
  });

  const selectedTokens = drawer ? new Set(drawer.selected >= 0 ? drawer.signals[drawer.selected].tokens : drawer.pending) : null;
  const tokenClass = (n) => {
    const classes = ['tok'];
    if (selectedTokens?.has(n)) classes.push('tok--selected');
    else if (!drawer && showAll && lastSignalType.has(n)) {
      classes.push('tok--highlighted-by-button', 'signal-color', `signal-type-${signalColorIndex(cfg, lastSignalType.get(n))}`);
    }
    if (!drawer && hoverTokens.has(n)) classes.push('tok--highlighted');
    return classes.join(' ');
  };
  const tokenEvents = (n) => {
    if (drawer) {
      const drag = (e) => { if (e.buttons & 1) pickToken(n, false); };
      return { onClick: () => pickToken(n, true), onMouseEnter: drag, onMouseLeave: drag };
    }
    if (!signalsEnabled) return {};
    return {
      onContextMenu: (e) => {
        e.preventDefault();
        const box = rootRef.current.getBoundingClientRect();
        setMenu({ x: e.clientX - box.left + rootRef.current.scrollLeft, y: e.clientY - box.top + rootRef.current.scrollTop, token: n });
      }
    };
  };

  // Dragging a node's number onto another node attaches it there (rstWeb's makeSource/makeTarget on .num_id);
  // with Ctrl held it adds a secondary edge instead. Holding the pointer in a band at the edge of the canvas scrolls it
  // (as legacy rstWeb did when dragging to the screen edge), so far-away nodes can be reached.
  const [drag, setDrag] = useState(null);
  const canvasRef = useRef(null);
  const startDrag = useCallback((event, id) => {
    if (event.button !== 0 || drawerOpen) return;
    event.preventDefault();
    const secondary = event.ctrlKey && cfg.useSecedge;
    const inner = innerRef.current;
    const canvas = canvasRef.current;
    const handle = event.currentTarget.getBoundingClientRect();
    const start = inner.getBoundingClientRect();
    // Coordinates inside the inner container do not change when the canvas scrolls, the pointer's do
    const x1 = handle.left + handle.width / 2 - start.left;
    const y1 = handle.top + handle.height / 2 - start.top;
    const pointer = { x: event.clientX, y: event.clientY };
    let frame = 0;
    const redraw = () => {
      const origin = inner.getBoundingClientRect();
      setDrag({ x1, y1, x2: pointer.x - origin.left, y2: pointer.y - origin.top, secondary });
    };
    // Scroll speed grows from 0 at the inner edge of the band to EDGE_SPEED at (or beyond) the canvas border
    const speed = (pos, low, high) => {
      if (pos < low + EDGE_BAND) return -EDGE_SPEED * Math.min(1, (low + EDGE_BAND - pos) / EDGE_BAND);
      if (pos > high - EDGE_BAND) return EDGE_SPEED * Math.min(1, (pos - (high - EDGE_BAND)) / EDGE_BAND);
      return 0;
    };
    const tick = () => {
      const box = canvas.getBoundingClientRect();
      const dx = speed(pointer.x, box.left, box.right);
      const dy = speed(pointer.y, box.top, box.bottom);
      const [left, top] = [canvas.scrollLeft, canvas.scrollTop];
      canvas.scrollLeft += dx;
      canvas.scrollTop += dy;
      if (canvas.scrollLeft !== left || canvas.scrollTop !== top) redraw();
      frame = requestAnimationFrame(tick);
    };
    const move = (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      redraw();
    };
    const stop = (e) => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      setDrag(null);
      if (e.type !== 'pointerup') return;
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-rst-node]');
      const target = hit && inner.contains(hit) ? Number(hit.dataset.rstNode) : null;
      if (target === null || target === id) return;
      dispatch(secondary ? { type: 'addSecedge', source: id, target, relname: null } : { type: 'attach', id, parent: target });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    frame = requestAnimationFrame(tick);
  }, [dispatch, drawerOpen, cfg.useSecedge]);

  // Ctrl+E: type "child,parent" to attach a node without dragging (ids as shown on double-click); "child,parent,s" adds a secondary edge
  const promptEdge = () => {
    const ids = new Set([...model.edus, ...model.groups].map((n) => n.id));
    const answer = window.prompt(
      `Attach a node: enter "child,parent" (e.g. 1,2 sets the parent of node 1 to node 2).${cfg.useSecedge ? ' Add ",s" for a secondary edge.' : ''} Double-click a node to see its ID.`, ''
    );
    if (answer === null || !answer.includes(',')) return;
    const [child, parent, mode] = answer.split(',').map((s) => s.trim());
    const [source, target] = [Number(child), Number(parent)];
    if (!ids.has(source) || !ids.has(target) || source === target) {
      window.alert('Please enter two different, existing node IDs separated by a comma.');
      return;
    }
    if (mode === 's' && cfg.useSecedge) dispatch({ type: 'addSecedge', source, target, relname: null });
    else dispatch({ type: 'attach', id: source, parent: target });
  };

  const showId = (id) => window.alert(`Discourse unit ID:\n${id}`);

  // rs4 import / export: a modal with a text area to paste into or copy from
  const [rs4Dialog, setRs4Dialog] = useState(null); // { kind: 'import' | 'export', text, message }
  const openExport = () => {
    const text = serializeRs4(model, parsed.sheet.tokens.map((t) => t.text), { relations: cfg.relations, signalTypes: cfg.signalTypes });
    setRs4Dialog({ kind: 'export', text, message: '' });
  };
  const applyImport = () => {
    let imported;
    try {
      imported = parseRs4(rs4Dialog.text);
    } catch {
      imported = null;
    }
    if (!imported || !imported.model.edus.length) {
      setRs4Dialog((d) => ({ ...d, message: 'No rs4 data found. Paste the full contents of an .rs4 file.' }));
      return;
    }
    const docWords = parsed.sheet.tokens.map((t) => t.text);
    // An empty document takes the text, EDUs and analysis from the file
    if (!docWords.some((w) => w.trim())) {
      const filled = withWords(value, imported.words, config);
      const filledParsed = parseSocialCalc(filled, config);
      const { error: problem, model: fitted } = fitRs4Import(imported, filledParsed.sheet.tokens.map((t) => t.text), filledParsed.model, { adoptEdus: true });
      if (problem) {
        setRs4Dialog((d) => ({ ...d, message: `Cannot import: ${problem}` }));
        return;
      }
      onChange?.(serializeSocialCalc(filledParsed.sheet, fitted, config));
      setRs4Dialog(null);
      return;
    }
    let result = fitRs4Import(imported, docWords, model, { adoptEdus: model.edus.length === 0 });
    if (result.conflict && window.confirm(
      `${result.error}\n\nThe EDU segmentation of the document differs from the one in the rs4 file. ` +
      'Overwrite the document\'s EDUs with those of the rs4 file?'
    )) {
      result = fitRs4Import(imported, docWords, model, { adoptEdus: true });
    }
    if (result.error) {
      setRs4Dialog((d) => ({ ...d, message: `Cannot import: ${result.error}${result.conflict ? ' Segment the document first, using the same EDUs.' : ''}` }));
      return;
    }
    dispatch({ type: 'replace', model: result.model });
    setRs4Dialog(null);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setMenu(null);
      setRs4Dialog(null);
      if (drawerOpen) cancelDrawer();
      return;
    }
    if (rs4Dialog || e.target.closest?.('textarea, input')) return;
    if (drawerOpen || !(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) dispatch({ type: 'undo' });
    else if (key === 'y' || (key === 'z' && e.shiftKey)) dispatch({ type: 'redo' });
    else if (key === 'e') promptEdge();
    else return;
    e.preventDefault();
  };

  if (error) return <div className={`rstweb-root rstweb-error ${className}`} role="alert">{error}</div>;
  const { sheet } = parsed;
  const hasWords = sheet.tokens.some((t) => t.text.trim());
  const notice = !hasWords
    ? `No words found in column "${cfg.words}". You can import an rs4 file to start from its text, EDUs and analysis.`
    : (!model.edus.length ? 'No EDU segmentation found. Segment the text into EDUs first, or import an rs4 file.' : null);
  const { nodes } = layout;

  return (
    <div ref={rootRef} className={`rstweb-root${drawerOpen ? ' rstweb-root--drawer' : ''} ${className}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="rstweb-toolbar">
        <button type="button" disabled={drawerOpen || !canUndo(current)} onClick={() => dispatch({ type: 'undo' })} title="Undo (Ctrl+Z)"><Undo2 size={14} /> Undo</button>
        <button type="button" disabled={drawerOpen || !canRedo(current)} onClick={() => dispatch({ type: 'redo' })} title="Redo (Ctrl+Y)"><Redo2 size={14} /> Redo</button>
        {signalsEnabled && (
          <button type="button" disabled={drawerOpen} onClick={() => setShowAll((v) => !v)}>
            {showAll ? <EyeOff size={14} /> : <Highlighter size={14} />} {showAll ? 'Hide Signal Tokens' : 'Show All Signal Tokens'}
          </button>
        )}
        <button type="button" disabled={drawerOpen || notice !== null} onClick={openExport} title="Show the analysis as rstWeb .rs4 XML to copy"><Upload size={14} /> Export rs4</button>
        <button type="button" disabled={drawerOpen} onClick={() => setRs4Dialog({ kind: 'import', text: '', message: '' })} title="Replace the analysis with pasted .rs4 XML for the same text and EDUs"><Download size={14} /> Import rs4</button>
        {current.error && (
          <span className="rstweb-message" role="alert">
            {current.error} <button type="button" onClick={() => dispatch({ type: 'clearError' })}>OK</button>
          </span>
        )}
      </div>
      <div className="rstweb-body">
        {notice && <div className="rstweb-notice">{notice}</div>}
        {!notice && <>
        <SignalDrawer cfg={cfg} drawer={drawer} setDrawer={setDrawer} onSave={saveDrawer} onCancel={cancelDrawer} />
        <div className="rstweb-canvas-wrap">
          <div className="rstweb-canvas" ref={canvasRef}>
            <div className="rstweb-inner" ref={attachCanvas} style={{ width: layout.width, height: layout.height }}>
            {model.edus.map((edu) => {
              const box = nodes.get(edu.id);
              return (
                <div key={`edu${edu.id}`} data-rst-node={edu.id} className={`edu${drawerOpen ? ' edu--clickable' : ''}${invalid.has(edu.id) ? ' rstweb-invalid' : ''}`} style={{ left: box.x, top: box.y, width: box.width }}>
                  <div className="whisker" style={{ width: box.width }} />
                  <div className="edu_num_cont"><NodeButtons id={edu.id} label={`\u00a0${edu.id}\u00a0`} cfg={cfg} dispatch={dispatch} onDragStart={startDrag} onShowId={showId} /></div>
                  {sheet.tokens.slice(edu.start, edu.end).map((token, i) => (
                    <React.Fragment key={edu.start + i}>
                      <span className={tokenClass(edu.start + i + 1)} {...tokenEvents(edu.start + i + 1)}>{token.text}</span>{' '}
                    </React.Fragment>
                  ))}
                </div>
              );
            })}
            {model.groups.map((group) => {
              const box = nodes.get(group.id);
              return (
                <React.Fragment key={`group${group.id}`}>
                  <div className={`group${invalid.has(group.id) ? ' rstweb-invalid' : ''}`} style={{ left: box.x, width: box.width, top: box.y, zIndex: 1 }}>
                    <div className="whisker" />
                  </div>
                  <div data-rst-node={group.id} className="num_cont" style={{ position: 'absolute', left: box.anchorX, top: box.anchorY, zIndex: box.z }}>
                    <NodeButtons id={group.id} label={`${box.left}-${box.right}`} cfg={cfg} dispatch={dispatch} onDragStart={startDrag} onShowId={showId} />
                  </div>
                </React.Fragment>
              );
            })}
            {edges.map((edge) => overlays.has(edge.key) && createPortal(
              <EdgeLabel
                edge={edge}
                cfg={cfg}
                signals={model.signals}
                dispatch={dispatch}
                active={drawer !== null && drawer.source === edge.source && drawer.target === signalTarget(edge)}
                onSignals={openDrawer}
                onHover={setHover}
              />,
              overlays.get(edge.key),
              edge.key
            ))}
            {drag && (
              <svg className="rstweb-drag" style={{ position: 'absolute', left: 0, top: 0, width: layout.width, height: layout.height, pointerEvents: 'none', zIndex: 6000 }}>
                <line x1={drag.x1} y1={drag.y1} x2={drag.x2} y2={drag.y2} stroke={drag.secondary ? 'rgba(0,0,255,1)' : 'rgba(0,0,0,0.5)'} strokeWidth="2" />
              </svg>
            )}
            </div>
          </div>
          {drag && <EdgeBands canvasRef={canvasRef} />}
        </div>
        </>}
      </div>
      {rs4Dialog && (
        <div className="rstweb-modal-backdrop" onMouseDown={() => setRs4Dialog(null)}>
          <div className="rstweb-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="rstweb-modal-title">{rs4Dialog.kind === 'import' ? 'Import rs4' : 'Export rs4'}</div>
            <div>
              {rs4Dialog.kind === 'import'
                ? 'Paste the contents of an .rs4 file. The text must be the same as this document\'s. The current analysis is replaced (undoable); if the document has no text or EDUs yet, or you confirm, they are taken from the file.'
                : 'rstWeb .rs4 XML for this document:'}
            </div>
            <textarea
              className="rstweb-modal-textarea"
              value={rs4Dialog.text}
              readOnly={rs4Dialog.kind === 'export'}
              autoFocus
              spellCheck={false}
              onFocus={(e) => { if (rs4Dialog.kind === 'export') e.target.select(); }}
              onChange={(e) => setRs4Dialog({ ...rs4Dialog, text: e.target.value, message: '' })}
            />
            {rs4Dialog.message && <div className="rstweb-message" role="alert">{rs4Dialog.message}</div>}
            <div className="rstweb-modal-actions">
              <button type="button" onClick={() => setRs4Dialog(null)}>Close</button>
              {rs4Dialog.kind === 'import' && <button type="button" disabled={!rs4Dialog.text.trim()} onClick={applyImport}>Import</button>}
            </div>
          </div>
        </div>
      )}
      {menu && (
        <ul className="custom-menu" style={{ left: menu.x, top: menu.y }}>
          <li onClick={() => { dispatch({ type: 'removeSignalsAtToken', token: menu.token }); setMenu(null); }}>Delete signals containing this word</li>
        </ul>
      )}
    </div>
  );
}
