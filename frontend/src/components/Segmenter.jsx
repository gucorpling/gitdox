/*
* @file Segmenter: discourse unit / sentence segmentation editor over SocialCalc layers
*/

import React, { useState, useMemo, useCallback } from 'react';
import { parseSocialCalc, serializeSocialCalc, normalizeLayers, isNesting } from './segmenter/segmenter-io';
import { normalizeFontFamily } from '../appShared';
import { checkSegmenterConflict } from './rstweb/rst-config';
import './segmenter/segmenter.css';

const toCssLength = (v) => (typeof v === 'number' ? `${v}px` : typeof v === 'string' && v.trim() ? v.trim() : undefined);

const buildModel = (value, config) => {
  try {
    const parsed = parseSocialCalc(value, config);
    return { parsed, boundaries: parsed.boundaries, error: null };
  } catch (err) {
    return { parsed: null, boundaries: null, error: err.message };
  }
};

export default function Segmenter({ value, config, rstConfig, onChange, fontFamily, className = '' }) {
  const layers = useMemo(() => normalizeLayers(config), [config]);
  const nesting = isNesting(config);
  const [lastEmitted, setLastEmitted] = useState(null);
  const [model, setModel] = useState(() => buildModel(value, config));
  const [activeLayerChoice, setActiveLayer] = useState(layers[0]?.name);
  const [syncedSource, setSyncedSource] = useState({ value, config });
  const activeLayer = layers.some((l) => l.name === activeLayerChoice) ? activeLayerChoice : layers[0]?.name;

  // Re-parse if the document or config changes from outside (but not for our own emitted changes)
  if (syncedSource.value !== value || syncedSource.config !== config) {
    setSyncedSource({ value, config });
    if (value !== lastEmitted || syncedSource.config !== config) setModel(buildModel(value, config));
  }

  const { parsed, boundaries, error: parseError } = model;
  const conflict = useMemo(() => checkSegmenterConflict(rstConfig, config), [rstConfig, config]);
  const error = conflict || parseError;

  const toggleBoundary = useCallback((layerName, tokenIndex) => {
    if (tokenIndex === 0) return; // The start of the document is always an implicit boundary

    const next = { ...boundaries };
    if (boundaries[layerName].has(tokenIndex)) {
      next[layerName] = new Set(boundaries[layerName]);
      next[layerName].delete(tokenIndex);
    } else {
      // In nesting mode a break also starts a segment in every smaller layer
      const start = layers.findIndex((l) => l.name === layerName);
      const affected = nesting ? layers.slice(start) : [layers[start]];
      affected.forEach(({ name }) => {
        next[name] = new Set(boundaries[name]);
        next[name].add(tokenIndex);
      });
    }

    setModel({ parsed, boundaries: next, error: null });
    const updated = serializeSocialCalc(parsed, next, config);
    setLastEmitted(updated);
    onChange?.(updated);
  }, [boundaries, parsed, config, onChange, layers, nesting]);

  if (layers.length === 0) {
    return <div className="segmenter-container">No segmentation layers are configured (segmenter.layers).</div>;
  }

  if (error) {
    return <div className="segmenter-container segmenter-error" role="alert">{error}</div>;
  }

  const style = {
    fontFamily: normalizeFontFamily(config?.font) || fontFamily || undefined,
    fontSize: toCssLength(config?.font_size),
    '--seg-line-height': config?.line_spacing ?? undefined,
    '--seg-word-spacing': toCssLength(config?.word_spacing)
  };
  const activeLayerConfig = layers.find((l) => l.name === activeLayer);

  return (
    <div className={`segmenter-container ${className}`} style={style}>
      <div className="segmenter-controls">
        <h3>Segmentation layer:</h3>
        {layers.map(({ name, separator, color }) => (
          <label key={name} className="layer-toggle">
            <input
              type="radio"
              name="activeLayer"
              value={name}
              checked={activeLayer === name}
              onChange={() => setActiveLayer(name)}
            />
            {' '}{name} <span style={{ color }}>{separator}</span>
          </label>
        ))}
      </div>

      <div className="canvas">
        {parsed.tokens.map((token, i) => (
          <React.Fragment key={token.row}>
            {i > 0 && (
              <BoundaryStack
                layers={layers}
                boundaries={boundaries}
                tokenIndex={i}
                nesting={nesting}
                activeLayer={activeLayer}
                activeLayerConfig={activeLayerConfig}
                onToggle={toggleBoundary}
              />
            )}
            <span className="token">{token.text}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function BoundaryStack({ layers, boundaries, tokenIndex, nesting, activeLayer, activeLayerConfig, onToggle }) {
  const hasActiveBoundary = boundaries[activeLayer]?.has(tokenIndex);
  let present = layers.filter(({ name }) => boundaries[name]?.has(tokenIndex));
  // Nested breaks are implied by the largest layer starting here, so only that marker is shown
  if (nesting) present = present.slice(0, 1);

  return (
    <div className="boundary-stack">
      {present.map(({ name, separator, color }) => {
        const isActive = name === activeLayer;
        return (
          <span
            key={name}
            className={`boundary-marker ${isActive ? 'active-marker' : ''}`}
            style={{ color }}
            onClick={() => isActive && onToggle(name, tokenIndex)}
            title={isActive ? `Remove ${name} break` : name}
          >
            {separator}
          </span>
        );
      })}

      {!hasActiveBoundary && activeLayerConfig && (
        <span
          className="insertion-point"
          style={{ color: activeLayerConfig.color }}
          onClick={() => onToggle(activeLayer, tokenIndex)}
          title={`Add ${activeLayer} break`}
        >
          {activeLayerConfig.separator}
        </span>
      )}
    </div>
  );
}
