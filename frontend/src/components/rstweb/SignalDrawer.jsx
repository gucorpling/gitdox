/*
* @file Signal drawer of the RST editor: edits the signals (type, subtype, tokens) of one relation, as in legacy rstWeb.
* Pure view over `drawer` state owned by RstWeb: { source, target, signals, selected, pending, initial }.
* Tokens are chosen by clicking or dragging over words in the tree, which RstWeb routes into the selected signal.
*/

import { newSignal } from './rst-edges';

export default function SignalDrawer({ cfg, drawer, setDrawer, onSave, onCancel }) {
  const types = Object.keys(cfg.signalTypes);
  const open = drawer !== null;

  const update = (index, patch) => setDrawer((d) => ({
    ...d, signals: d.signals.map((s, i) => (i === index ? { ...s, ...patch } : s))
  }));

  const select = (index) => setDrawer((d) => {
    if (d.selected === index) return d;
    // Words picked while no signal was selected are handed to the signal that gets selected
    const signals = d.pending.length === 0 ? d.signals
      : d.signals.map((s, i) => (i === index ? { ...s, tokens: [...new Set([...s.tokens, ...d.pending])] } : s));
    return { ...d, signals, selected: index, pending: [] };
  });

  const remove = (index) => setDrawer((d) => ({ ...d, signals: d.signals.filter((_, i) => i !== index), selected: -1, pending: [] }));

  const add = () => setDrawer((d) => {
    const fresh = newSignal(cfg, d.selected < 0 ? d.pending : []);
    return { ...d, signals: [...d.signals, fresh], selected: d.signals.length, pending: [] };
  });

  return (
    <div className={`signal-drawer${open ? ' signal-drawer--active' : ''}`} aria-hidden={!open}>
      {open && (
        <div className="signal-drawer__inner">
          <div className="signal-drawer__hint">Click or drag over words in the tree to assign them to the selected signal.</div>
          {drawer.signals.map((signal, index) => (
            <div
              key={index}
              className={`signal-drawer__item${index === drawer.selected ? ' signal-drawer__item--selected' : ''}`}
              onClick={() => select(index)}
            >
              <div className="signal-drawer__row">
                <label className="signal-drawer__label">Type:</label>
                <select
                  className="signal-drawer__select"
                  value={signal.type}
                  onChange={(e) => update(index, { type: e.target.value, subtype: cfg.signalTypes[e.target.value]?.[0] ?? '' })}
                >
                  {types.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <button
                type="button"
                className="button signal-drawer__item-delete"
                title="delete signal"
                onClick={(e) => { e.stopPropagation(); remove(index); }}
              >
                X
              </button>
              <div className="signal-drawer__row">
                <label className="signal-drawer__label">Subtype:</label>
                <select className="signal-drawer__select" value={signal.subtype} onChange={(e) => update(index, { subtype: e.target.value })}>
                  {(cfg.signalTypes[signal.type] || []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          ))}
          <div className="signal-drawer__buttons">
            <button type="button" className="signal-drawer__create-new-button" onClick={add}>New signal</button>
          </div>
          <div className="signal-drawer__buttons">
            <button type="button" className="signal-drawer__save-button" onClick={onSave}>Save</button>
            <button type="button" className="signal-drawer__cancel-button" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
