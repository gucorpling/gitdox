import React from 'react';
import { createRoot } from 'react-dom/client';
import Spannotator from './components/Spannotator';
import { SAMPLE_WEBANNO } from './demo-data.js';
import './index.css';

const config = {
  annotations: {
    entity: { identity: 'identity' },
    keys: {
      infstat: {
        values: ['auto', 'new', 'acc', 'giv', 'split'],
        stars: { acc: 'yellow', split: 'green' }
      }
    },
    checks: { salience: [5, 'n', 's'] }
  },
  carousel: {
    keys: ['Summary1', 'Summary2', 'Summary3', 'Summary4', 'Summary5'],
    sync: 'salience'
  },
  colors: {
    groups: { coref: ['chain', 'sametype'], split: ['star', 'anytype'] },
    edges: {
      bridge: {
        bridgetype: ['nobridge', 'comparison-relative', 'comparison-sense', 'comparison-time', 'entity-associative', 'entity-meronymy', 'entity-property', 'entity-resultative', 'set-member', 'set-subset', 'set-span-interval', 'other'],
        show_coarse: true
      }
    }
  },
  sentences: 's_type',
  sentence_mode: true,
  default_color_mode: 'coref',
  webanno_order: ['entity', 'infstat', 'salience', 'identity']
};

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Spannotator value={SAMPLE_WEBANNO} config={config} replaceOnImport />
  </React.StrictMode>
);
