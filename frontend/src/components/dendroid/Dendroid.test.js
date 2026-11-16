import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { mergeSentences } from './sentences.js';

let server;
let Dendroid;

before(async () => {
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  });
  ({ Dendroid } = await server.ssrLoadModule('/src/components/Dendroid.jsx'));
});

after(async () => {
  if (server) await server.close();
});

function sentenceTitles(boundaryCells, words = ['Flatworm', 'Evolution', 'Species']) {
  const cells = [
    'cell:A1:t:uid', 'cell:B1:t:tok', 'cell:C1:t:parent',
    'cell:D1:t:deprel', 'cell:E1:t:s_type',
    ...words.flatMap((word, i) => {
      const row = i + 2;
      return [
        `cell:A${row}:t:${i + 1}`, `cell:B${row}:t:${word}`,
        `cell:C${row}:t:0`, `cell:D${row}:t:root`,
      ];
    }),
    ...boundaryCells,
  ];
  const html = renderToStaticMarkup(React.createElement(Dendroid, {
    initialData: cells.join('\n'),
    initialFormat: 'socialcalc',
    defaultAnnotator: 'parser',
    textCol: '',
    sentBoundCol: 's_type',
    sentenceAnnotations: ['s_type'],
    colMappings: { id: 'uid', form: 'tok', head: 'parent', deprel: 'deprel' },
    features: {},
  }));
  return Array.from(html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g), match => match[1]);
}

test('adjacent single-token sentences with identical labels remain separate', () => {
  assert.deepEqual(sentenceTitles([
    'cell:E2:t:frag', 'cell:E3:t:frag', 'cell:E4:t:frag',
  ]), ['Flatworm', 'Evolution', 'Species']);
});

test('equal labels split at anchors but not within merged spans', () => {
  assert.deepEqual(sentenceTitles([
    'cell:E2:t:frag', 'cell:E3:t:frag:rowspan:2',
  ]), ['Flatworm', 'Evolution Species']);
  assert.deepEqual(sentenceTitles([
    'cell:E2:t:frag:rowspan:2', 'cell:E4:t:frag',
  ]), ['Flatworm Evolution', 'Species']);
});

test('missing boundary cells continue the current sentence', () => {
  assert.deepEqual(sentenceTitles([
    'cell:E2:t:frag', 'cell:E4:t:decl',
  ]), ['Flatworm Evolution', 'Species']);
});

const ann = (head, deprel, deps = '_') => ({ head, deprel, deps });
const token = (id, globalId, annotations, extra = {}) => ({
  id, _originalGlobalId: globalId, form: `w${globalId}`, misc: '_',
  annotations, _rowspan: 1, _subRows: [], ...extra,
});
const sentence = (tokens, activeAnnotator, extra = {}) => ({
  id: 's', tokens, activeAnnotator, mwts: [], comments: [], metadata: {}, text: '', ...extra,
});

test('merge remaps local and external edges, empty nodes and multiword tokens for every annotator', () => {
  const first = sentence([
    token('1', '1', { parser: ann('ext:3', 'dep', 'ext:3:obl:tmod|0:root'), Alice: ann('0', 'root') }),
    token('2', '2', { parser: ann('1', 'obj') }),
  ], 'Alice', { metadata: { sent_id: 'a', text: 'First', type: 'one' }, text: 'First' });
  const second = sentence([
    token('1', '3', { parser: ann('2', 'nsubj', 'ext:1:dep'), Bob: ann('0', 'root') }),
    token('2', '4', { parser: ann('0', 'root'), Bob: ann('1', 'obj', '1.1:dep') }),
    token('1.1', '3.1', { parser: ann('_', '_', '2:dep'), Bob: ann('_', '_', '2:dep') }),
  ], 'Bob', {
    metadata: { sent_id: 'b', text: 'Second', type: 'two' }, text: 'Second',
    mwts: [{ id: '1-2', form: 'combined' }],
  });
  const merged = mergeSentences(first, second, {
    currentUser: 'Carol', defaultAnnotator: 'parser', perUserMode: true, textCol: 'text',
  });
  assert.deepEqual(merged.tokens.map(t => t.id), ['1', '2', '3', '4', '3.1']);
  assert.equal(merged.mwts[0].id, '3-4');
  assert.equal(merged.tokens[0].annotations.parser.head, '3');
  assert.equal(merged.tokens[0].annotations.parser.deps, '0:root|3:obl:tmod');
  assert.equal(merged.tokens[2].annotations.parser.head, '4');
  assert.equal(merged.tokens[2].annotations.parser.deps, '1:dep');
  assert.equal(merged.tokens[3].annotations.Bob.deps, '3.1:dep');
  assert.equal(merged.tokens[4].annotations.Bob.deps, '4:dep');
  assert.equal(merged.tokens[0].annotations.Carol.deprel, 'root');
  assert.equal(merged.tokens[1].annotations.Carol.head, '_');
  assert.equal(merged.tokens[3].annotations.Carol.head, '3');
  assert.deepEqual(merged.metadata, { sent_id: 'a', text: 'First Second', type: 'one' });
  assert.equal(merged.activeAnnotator, 'Carol');
  assert.equal(first.tokens[0].annotations.parser.head, 'ext:3');
});

test('merge preserves existing user data per sentence and external references outside the merge', () => {
  const first = sentence([token('1', '10', { parser: ann('0', 'root'), Carol: ann('ext:99', 'dep', 'ext:99:obl') })], 'parser');
  const second = sentence([token('1', '11', { parser: ann('0', 'root') })], 'parser');
  const merged = mergeSentences(first, second, {
    currentUser: 'Carol', defaultAnnotator: 'parser', perUserMode: true, textCol: '',
  });
  assert.deepEqual(merged.tokens[0].annotations.Carol, ann('ext:99', 'dep', 'ext:99:obl'));
  assert.deepEqual(merged.tokens[1].annotations.Carol, ann('0', 'root'));
  assert.equal(merged.text, 'w10 w11');
});

test('merge normalizes spreadsheet empty-node ids when ellipsis display is disabled', () => {
  const first = sentence([
    token('1', '10', { parser: ann('0', 'root', '1.1:dep') }),
    token('10.1', '10.1', { parser: ann('_', '_', '1:dep') }),
  ], 'parser');
  const second = sentence([
    token('1', '11', { parser: ann('0', 'root', '1.1:dep') }),
    token('11.1', '11.1', { parser: ann('_', '_', '1:dep') }),
  ], 'parser');
  const merged = mergeSentences(first, second, {
    currentUser: 'Carol', defaultAnnotator: 'parser', perUserMode: true, textCol: '',
  });
  assert.deepEqual(merged.tokens.map(t => t.id), ['1', '1.1', '2', '2.1']);
  assert.equal(merged.tokens[0].annotations.Carol.deps, '1.1:dep');
  assert.equal(merged.tokens[2].annotations.Carol.deps, '2.1:dep');
});

test('merge button is present on every sentence except the last', () => {
  const data = [
    'cell:A1:t:uid', 'cell:B1:t:tok', 'cell:C1:t:s_type',
    'cell:A2:t:1', 'cell:B2:t:First', 'cell:C2:t:a',
    'cell:A3:t:2', 'cell:B3:t:Second', 'cell:C3:t:b',
    'cell:A4:t:3', 'cell:B4:t:Third', 'cell:C4:t:c',
  ].join('\n');
  const html = renderToStaticMarkup(React.createElement(Dendroid, {
    initialData: data, initialFormat: 'socialcalc', textCol: '', sentBoundCol: 's_type',
    sentenceAnnotations: [], colMappings: { id: 'uid', form: 'tok' }, features: {},
  }));
  assert.equal((html.match(/title="Merge with next sentence"/g) || []).length, 2);
});
