import test from 'node:test';
import assert from 'node:assert/strict';
import { exportSpannotatorData, importSpannotatorData } from './io.js';
import { DEFAULT_SPANNOTATOR_CONFIG, assertStateInvariants, buildSpannotatorConfig, getAnnotationCheckSettings, getAnnotationKeys, getAnnotationStarColor, parseTextToTokens } from './model.js';

function buildSeedData() {
  const tokens = parseTextToTokens('John saw Mary\nShe smiled');
  const tokensById = Object.fromEntries(tokens.map((tok) => [tok.tid, tok]));

  const entities = {
    '1-1': {
      type: 'person',
      start: 1,
      end: 1,
      toks: [1],
      length: 1,
      div_id: '1-1',
      annos: { infstat: 'giv', salience: 'ssnnn', bridgetype: 'nobridge' },
      salienceField: true,
      identity: '_',
      bridge_antec: '_',
      next: {},
      groups: { coref: 1, bridge: 0 }
    },
    '3-3': {
      type: 'person',
      start: 3,
      end: 3,
      toks: [3],
      length: 1,
      div_id: '3-3',
      annos: { infstat: 'giv', salience: 'ssnnn', bridgetype: 'nobridge' },
      salienceField: true,
      identity: '_',
      bridge_antec: '_',
      next: {},
      groups: { coref: 1, bridge: 1 }
    },
    '4-4': {
      type: 'person',
      start: 4,
      end: 4,
      toks: [4],
      length: 1,
      div_id: '4-4',
      annos: { infstat: 'acc', salience: 'nnnnn', bridgetype: 'entity-associative' },
      salienceField: true,
      identity: '_',
      bridge_antec: '3-3',
      next: {},
      groups: { coref: 0, bridge: 1 }
    }
  };

  const groups = {
    coref: { 0: ['4-4'], 1: ['1-1', '3-3'] },
    bridge: { 0: ['1-1'], 1: ['3-3', '4-4'] }
  };

  const assignedColors = {
    coref: { 0: DEFAULT_SPANNOTATOR_CONFIG.GLOBAL_DEFAULTS.DEFAULT_COLOR, 1: 'RoyalBlue' },
    bridge: { 0: DEFAULT_SPANNOTATOR_CONFIG.GLOBAL_DEFAULTS.DEFAULT_COLOR, 1: 'ForestGreen' }
  };

  return {
    tokens,
    tokensById,
    entities,
    groups,
    assignedColors,
    summaries: ['John and Mary are introduced.', 'She is salient in sentence 2.']
  };
}

function canonicalEntitySnapshot(entities) {
  return Object.keys(entities)
    .sort()
    .map((id) => {
      const entity = entities[id];
      return {
        id,
        type: entity.type,
        start: entity.start,
        end: entity.end,
        toks: [...entity.toks],
        annos: {
          infstat: entity.annos.infstat,
          salience: entity.annos.salience,
          bridgetype: entity.annos.bridgetype
        },
        bridge_antec: entity.bridge_antec,
        groups: {
          coref: Number(entity.groups.coref || 0),
          bridge: Number(entity.groups.bridge || 0)
        }
      };
    });
}

function assertImportInvariantSafe(imported) {
  const result = assertStateInvariants({
    tokens: imported.tokens,
    entitiesById: imported.entities,
    groupsByType: imported.groups,
    assignedColors: imported.assignedColors,
    config: DEFAULT_SPANNOTATOR_CONFIG,
    uiState: {
      selectedTokens: new Set(),
      selectedEntities: new Set(),
      dialogs: {}
    }
  }, { throwOnError: false });

  assert.equal(result.ok, true, result.errors.join('\n'));
}

test('WebAnno export/import preserves entities and grouping semantics', () => {
  const seed = buildSeedData();
  const exported = exportSpannotatorData({
    format: 'webanno',
    tokens: seed.tokens,
    tokensById: seed.tokensById,
    entities: seed.entities,
    groups: seed.groups,
    summaries: seed.summaries
  });

  const imported = importSpannotatorData(exported);
  assertImportInvariantSafe(imported);

  assert.deepEqual(
    imported.tokens.map((tok) => tok.word),
    seed.tokens.map((tok) => tok.word)
  );

  assert.deepEqual(
    canonicalEntitySnapshot(imported.entities),
    canonicalEntitySnapshot(seed.entities)
  );

  assert.deepEqual(imported.summaries, seed.summaries);
});

test('TT roundtrip remains stable across repeated import/export', () => {
  const seed = buildSeedData();

  const firstTt = exportSpannotatorData({
    format: 'tt',
    tokens: seed.tokens,
    tokensById: seed.tokensById,
    entities: seed.entities,
    groups: seed.groups,
    summaries: seed.summaries
  });

  const firstImport = importSpannotatorData(firstTt);
  assertImportInvariantSafe(firstImport);

  const secondTt = exportSpannotatorData({
    format: 'tt',
    tokens: firstImport.tokens,
    tokensById: Object.fromEntries(firstImport.tokens.map((tok) => [tok.tid, tok])),
    entities: firstImport.entities,
    groups: firstImport.groups,
    summaries: firstImport.summaries
  });

  const secondImport = importSpannotatorData(secondTt);
  assertImportInvariantSafe(secondImport);

  assert.deepEqual(
    secondImport.tokens.map((tok) => tok.word),
    firstImport.tokens.map((tok) => tok.word)
  );

  assert.deepEqual(
    canonicalEntitySnapshot(secondImport.entities),
    canonicalEntitySnapshot(firstImport.entities)
  );
});

test('WebAnno import keeps edge columns when token lines end with trailing tab', () => {
  const raw = [
    '#FORMAT=WebAnno TSV 3.2',
    '#T_SP=webanno.custom.Referent|entity|infstat|salience|identity',
    '#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent',
    '',
    '#Text=alpha beta',
    '1-1\t0-5\talpha\tevent[1]\tnew[1]\tsssss[1]\t_\t_\t_\t',
    '1-2\t6-10\tbeta\tevent[2]\tacc[2]\tnnnnn[2]\tcomparison-relative[2]\tcoref|bridge:comparison-relative\t1-2[2_1]|1-2[2_1]\t'
  ].join('\n');

  const imported = importSpannotatorData(raw);
  assertImportInvariantSafe(imported);

  const corefGroupIds = Object.keys(imported.groups.coref)
    .map((id) => Number(id))
    .filter((id) => id > 0);
  const bridgeGroupIds = Object.keys(imported.groups.bridge)
    .map((id) => Number(id))
    .filter((id) => id > 0);

  assert.ok(corefGroupIds.length >= 1, 'Expected at least one non-zero coref group from edge columns');
  assert.ok(bridgeGroupIds.length >= 1, 'Expected at least one non-zero bridge group from edge columns');

  const hasBridgeAnaphor = Object.values(imported.entities).some(
    (entity) => Number(entity.groups.bridge || 0) > 0 && entity.bridge_antec && entity.bridge_antec !== '_'
  );
  assert.ok(hasBridgeAnaphor, 'Expected a bridge anaphor with antecedent from edge columns');
});

test('WebAnno import maps span columns using #T_SP keys instead of fixed positions', () => {
  const raw = [
    '#FORMAT=WebAnno TSV 3.2',
    '#T_SP=webanno.custom.Referent|entity|infstat|salience|identity',
    '#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent',
    '',
    '#Text=Harvard University',
    '1-1\t113-120\tHarvard\tplace[8]\tnew[8]\tnnnnn[8]\tHarvard_Yard[8]\t_\t_\t',
    '1-2\t121-131\tUniversity\torganization[9]\tnew[9]\tsnnnn[9]\tHarvard_University[9]\tcoref\t1-2[9_8]\t'
  ].join('\n');

  const imported = importSpannotatorData(raw);
  assertImportInvariantSafe(imported);

  const withIdentity = Object.values(imported.entities)
    .filter((entity) => entity.annos?.identity && entity.annos.identity !== '_')
    .map((entity) => entity.annos.identity)
    .sort();

  assert.deepEqual(withIdentity, ['Harvard_University', 'Harvard_Yard']);

  const bridgeMembers = Object.values(imported.entities)
    .filter((entity) => Number(entity.groups?.bridge || 0) > 0);
  assert.equal(bridgeMembers.length, 0, 'Coref edges must not be interpreted as bridge edges when span keys include identity');
});

test('WebAnno export uses config annotation keys/checks for #T_SP and span columns', () => {
  const seed = buildSeedData();
  seed.entities['1-1'].annos.identity = 'john_01';
  seed.entities['3-3'].annos.identity = 'mary_01';
  seed.entities['4-4'].annos.identity = 'mary_01';

  const exported = exportSpannotatorData({
    format: 'webanno',
    tokens: seed.tokens,
    tokensById: seed.tokensById,
    entities: seed.entities,
    groups: seed.groups,
    summaries: seed.summaries,
    config: {
      annotations: {
        keys: {
          entity: ['person', 'place'],
          infstat: ['new', 'giv', 'acc'],
          identity: ['_']
        },
        checks: {
          salience: [5, 'n', 's']
        }
      }
    }
  });

  const lines = exported.split('\n');
  assert.ok(
    lines.includes('#T_SP=webanno.custom.Referent|entity|infstat|identity|salience'),
    'Expected #T_SP to follow configured keys/checks order'
  );

  const firstDataRow = lines.find((line) => /^\d+-\d+\t/.test(line));
  assert.ok(firstDataRow, 'Expected at least one WebAnno token row');

  const fields = firstDataRow.split('\t');
  assert.equal(fields[3], 'person[1]');
  assert.equal(fields[4], 'giv[1]');
  assert.equal(fields[5], 'john_01[1]');
  assert.equal(fields[6], 'ssnnn[1]');
});

test('WebAnno export serializes only carousel-owned metadata keys when configured', () => {
  const seed = buildSeedData();
  const exported = exportSpannotatorData({
    format: 'webanno',
    tokens: seed.tokens,
    tokensById: seed.tokensById,
    entities: seed.entities,
    groups: seed.groups,
    summaries: ['Live summary one', 'Live summary two'],
    socialcalc: {
      meta: {
        summary_one: 'Meta summary one',
        summary_two: 'Meta summary two',
        untouched_meta: 'Do not serialize'
      }
    },
    config: {
      carousel: {
        keys: ['summary_one', 'summary_two']
      }
    }
  });

  const lines = exported.split('\n');
  assert.ok(lines.includes('#summary_one=Meta summary one'));
  assert.ok(lines.includes('#summary_two=Meta summary two'));
  assert.ok(!lines.some((line) => line.startsWith('#untouched_meta=')));
  assert.ok(!lines.some((line) => /^#Summary\d+=/.test(line)));
});

test('WebAnno import merges only owned metadata keys into existing sheet metadata', () => {
  const raw = [
    '#FORMAT=WebAnno TSV 3.2',
    '#T_SP=webanno.custom.Referent|entity',
    '#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent',
    '#summary_one=Incoming summary',
    '#untouched_meta=Incoming replacement should be ignored',
    '',
    '#Text=Alpha',
    '1-1\t0-5\tAlpha\t_\t_\t_'
  ].join('\n');

  const imported = importSpannotatorData(raw, {
    carousel: {
      keys: ['summary_one']
    },
    socialcalc: {
      meta: {
        summary_one: 'Old summary',
        untouched_meta: 'Keep me'
      },
      tokenRowsByTid: {
        1: { startRow: 2, endRow: 2 }
      }
    }
  });

  assert.equal(imported.socialcalc.meta.summary_one, 'Incoming summary');
  assert.equal(imported.socialcalc.meta.untouched_meta, 'Keep me');
  assert.deepEqual(imported.summaries, ['Incoming summary']);
});

test('TT import counts configured token container as one token', () => {
  const raw = [
    '<word word="aren\'t">',
    'are',
    "n't",
    '</word>'
  ].join('\n');

  const imported = importSpannotatorData(raw, { annotation: 'word', tok: 'word' });
  assert.equal(imported.tokens.length, 1);
  assert.equal(imported.tokens[0].word, "aren't");
});

test('TT import falls back to plain token lines when token container not configured', () => {
  const raw = [
    '<word word="aren\'t">',
    'are',
    "n't",
    '</word>'
  ].join('\n');

  const imported = importSpannotatorData(raw);
  assert.equal(imported.tokens.length, 2);
  assert.deepEqual(imported.tokens.map((tok) => tok.word), ['are', "n't"]);
});

test('buildSpannotatorConfig parses configurable star rules and carousel sync metadata', () => {
  const config = buildSpannotatorConfig({
    annotations: {
      keys: {
        infstat: {
          values: ['auto', 'new', 'acc', 'giv', 'split'],
          stars: {
            acc: 'yellow',
            split: 'green'
          }
        },
        identity: ''
      },
      checks: {
        highlight: [5, 'n', 's']
      }
    },
    carousel: {
      keys: ['summary1', 'summary2'],
      sync: 'highlight'
    }
  });

  assert.equal(config.ANNOTATION_KINDS.infstat, 'enum');
  assert.equal(config.ANNOTATION_KINDS.identity, 'text');
  assert.equal(getAnnotationStarColor(config, 'infstat', 'acc'), 'yellow');
  assert.equal(getAnnotationStarColor(config, 'infstat', 'split'), 'green');
  assert.deepEqual(getAnnotationCheckSettings(config, 'highlight'), { count: 5, falseChar: 'n', trueChar: 's' });
  assert.deepEqual(config.CAROUSEL_KEYS, ['summary1', 'summary2']);
  assert.equal(config.CAROUSEL_SYNC_KEY, 'highlight');
});

test('buildSpannotatorConfig keeps explicit empty annotation schemas empty', () => {
  const config = buildSpannotatorConfig({
    annotations: {
      entity: {
        entity: ['person', 'place']
      },
      keys: [],
      checks: {}
    },
    colors: {
      groups: [],
      edges: []
    }
  });

  assert.deepEqual(config.DEFAULT_ANNOS, { entity: 'person' });
  assert.deepEqual(config.ANNO_VALUES, { entity: ['person', 'place'] });
  assert.deepEqual(config.ANNOTATION_KEYS, []);
  assert.deepEqual(config.ANNOTATION_KINDS, {});
  assert.deepEqual(config.CHECK_SETTINGS_BY_KEY, {});
  assert.deepEqual(config.SALIENCE_SETTINGS, {});
  assert.deepEqual(config.GROUP_TYPES, []);
  assert.deepEqual(config.EDGE_TYPES, []);
  assert.deepEqual(getAnnotationKeys(config), []);
  assert.equal(config.ANNO_VALUES.infstat, undefined);
  assert.equal(config.ANNO_VALUES.salience, undefined);
  assert.equal(config.ANNO_VALUES.bridgetype, undefined);
});

test('WebAnno import preserves additional span key annotations such as food', () => {
  const rows = [
    ['1-1', '0-3', 'You', 'person[1]', 'acc[1]', 'nnnnn[1]', 'burger', '_', '_', ''],
    ['1-2', '4-7', 're', '_', '_', '_', '_', '_', '_', ''],
    ['1-3', '8-11', 'Not', '_', '_', '_', '_', '_', '_', ''],
    ['1-4', '12-17', 'Going', '_', '_', '_', '_', '_', '_', ''],
    ['1-5', '18-20', 'to', '_', '_', '_', '_', '_', '_', ''],
    ['1-6', '21-24', 'Get', '_', '_', '_', '_', '_', '_', ''],
    ['1-7', '25-33', 'Accepted', '_', '_', '_', '_', '_', '_', ''],
    ['1-8', '34-38', 'into', '_', '_', '_', '_', '_', '_', ''],
    ['1-9', '39-40', 'a', 'organization[2]', 'new[2]', 'nnnnn[2]', 'burger', '_', '_', ''],
    ['1-10', '41-44', 'Top', 'organization[2]', 'new[2]', 'nnnnn[2]', 'burger', '_', '_', ''],
    ['1-11', '45-55', 'University', 'organization[2]', 'new[2]', 'nnnnn[2]', 'burger', '_', '_', ''],
    ['1-12', '56-58', 'on', '_', '_', '_', '_', '_', '_', ''],
    ['1-13', '59-64', 'Merit', 'abstract[3]', 'acc[3]', 'snnnn[3]', 'pizza', '_', '_', ''],
    ['1-14', '65-70', 'Alone', '_', '_', '_', '_', '_', '_', ''],
    ['1-15', '71-72', '(', '_', '_', '_', '_', '_', '_', ''],
    ['1-16', '73-80', 'Warikoo', 'person[4]', 'new[4]', 'snnnn[4]', 'pizza', '_', '_', ''],
    ['1-17', '81-82', ')', '_', '_', '_', '_', '_', '_', '']
  ];

  const raw = [
    '#FORMAT=WebAnno TSV 3.2',
    '#T_SP=webanno.custom.Referent|entity|infstat|salience|food',
    '#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent',
    '',
    '#Text=You re Not Going to Get Accepted into a Top University on Merit Alone ( Warikoo )',
    ...rows.map((row) => row.join('\t'))
  ].join('\n');

  const imported = importSpannotatorData(raw, {
    annotations: {
      keys: {
        infstat: ['auto', 'new', 'acc', 'giv', 'split'],
        food: ['burger', 'pizza']
      },
      checks: {
        salience: [5, 'n', 's']
      }
    }
  });

  assertImportInvariantSafe(imported);

  const foods = Object.values(imported.entities)
    .map((entity) => entity.annos?.food)
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .sort();

  assert.deepEqual(foods, ['burger', 'burger', 'pizza', 'pizza']);
});

test('Custom span keys survive WebAnno to SocialCalc roundtrip', () => {
  const raw = [
    '#FORMAT=WebAnno TSV 3.2',
    '#T_SP=webanno.custom.Referent|entity|infstat|salience|food',
    '#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent',
    '',
    '#Text=Alice eats pizza',
    '1-1\t0-5\tAlice\tperson[1]\tnew[1]\tnnnnn[1]\tburger\t_\t_\t',
    '1-2\t6-10\teats\t_\t_\t_\t_\t_\t_\t',
    '1-3\t11-16\tpizza\tobject[2]\tacc[2]\tsnnnn[2]\tpizza\t_\t_\t'
  ].join('\n');

  const imported = importSpannotatorData(raw, {
    annotations: {
      checks: {
        salience: [5, 'n', 's']
      }
    }
  });

  const socialcalcRaw = exportSpannotatorData({
    format: 'socialcalc',
    tokens: imported.tokens,
    tokensById: Object.fromEntries(imported.tokens.map((tok) => [tok.tid, tok])),
    entities: imported.entities,
    groups: imported.groups,
    summaries: imported.summaries,
    socialcalc: {
      raw: [
        'socialcalc:version:1.0',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
        '--SocialCalcSpreadsheetControlSave',
        'Content-type: text/plain; charset=UTF-8',
        '',
        '# SocialCalc Spreadsheet Control Save',
        'version:1.0',
        'part:sheet',
        '--SocialCalcSpreadsheetControlSave',
        'Content-type: text/plain; charset=UTF-8',
        '',
        'version:1.5',
        'cell:A1:t:word:f:2',
        'cell:A2:t:Alice:f:1:tvf:1',
        'cell:A3:t:eats:f:1:tvf:1',
        'cell:A4:t:pizza:f:1:tvf:1',
        'sheet:c:1:r:4:tvf:2',
        '--SocialCalcSpreadsheetControlSave',
        'Content-type: text/plain; charset=UTF-8',
        '--SocialCalcSpreadsheetControlSave--'
      ].join('\n'),
      sheet: {
        cells: [
          { ref: 'A1', col: 'A', row: 1, colIndex: 1, type: 't', value: 'word', rawValue: 'word', attrs: { f: '2' }, rowspan: 1, rowEnd: 1 },
          { ref: 'A2', col: 'A', row: 2, colIndex: 1, type: 't', value: 'Alice', rawValue: 'Alice', attrs: { f: '1', tvf: '1' }, rowspan: 1, rowEnd: 2 },
          { ref: 'A3', col: 'A', row: 3, colIndex: 1, type: 't', value: 'eats', rawValue: 'eats', attrs: { f: '1', tvf: '1' }, rowspan: 1, rowEnd: 3 },
          { ref: 'A4', col: 'A', row: 4, colIndex: 1, type: 't', value: 'pizza', rawValue: 'pizza', attrs: { f: '1', tvf: '1' }, rowspan: 1, rowEnd: 4 }
        ],
        headerByCol: { A: 'word' },
        sheetMeta: { c: '1', r: '4', tvf: '2' }
      },
      mappings: {
        wordCols: ['A'],
        tokCols: [],
        sentCols: [],
        entityCols: [],
        annotationColsByKey: {},
        groupCorefCols: [],
        groupBridgeCols: [],
        entIdCols: [],
        bridgeAntecCols: []
      },
      rowToTokenId: { 2: 1, 3: 2, 4: 3 },
      tokenRowsByTid: {
        1: { startRow: 2, endRow: 2 },
        2: { startRow: 3, endRow: 3 },
        3: { startRow: 4, endRow: 4 }
      },
      entityExternalIdByDiv: {}
    },
    config: {
      annotations: {
        checks: {
          salience: [5, 'n', 's']
        }
      }
    }
  });

  const reimported = importSpannotatorData(socialcalcRaw, {
    annotations: {
      checks: {
        salience: [5, 'n', 's']
      }
    }
  });

  const foods = Object.values(reimported.entities)
    .map((entity) => entity.annos?.food)
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .sort();

  assert.deepEqual(foods, ['burger', 'pizza']);
});

test('SocialCalc payload with no word/tok column imports as empty state', () => {
  const raw = [
    'socialcalc:version:1.0',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    '# SocialCalc Spreadsheet Control Save',
    'version:1.0',
    'part:sheet',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    'version:1.5',
    'sheet:c:1:r:1:tvf:2',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '--SocialCalcSpreadsheetControlSave--'
  ].join('\n');

  const imported = importSpannotatorData(raw);

  assert.equal(imported.tokens.length, 0);
  assert.equal(Object.keys(imported.entities).length, 0);
  assert.ok(imported.socialcalc?.raw?.includes('sheet:c:1:r:1:tvf:2'));
});

test('WebAnno import writes sentence spans into configured SocialCalc sentence column when missing', () => {
  const webannoRaw = [
    '#FORMAT=WebAnno TSV 3.2',
    '#T_SP=webanno.custom.Referent|entity|infstat|salience',
    '#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent',
    '',
    '#Text=Alpha Beta',
    '1-1\t0-5\tAlpha\t_\t_\t_\t_\t_',
    '1-2\t6-10\tBeta\t_\t_\t_\t_\t_',
    '',
    '#Text=Gamma',
    '2-1\t11-16\tGamma\t_\t_\t_\t_\t_'
  ].join('\n');

  const imported = importSpannotatorData(webannoRaw, { sent: 's_type' });

  const emptySheetRaw = [
    'socialcalc:version:1.0',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    '# SocialCalc Spreadsheet Control Save',
    'version:1.0',
    'part:sheet',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    'version:1.5',
    'cell:A1:t:word:f:2',
    'cell:A2:t:Alpha:f:1:tvf:1',
    'cell:A3:t:Beta:f:1:tvf:1',
    'cell:A4:t:Gamma:f:1:tvf:1',
    'sheet:c:1:r:4:tvf:2',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '--SocialCalcSpreadsheetControlSave--'
  ].join('\n');

  const baseSocialcalc = importSpannotatorData(emptySheetRaw, { word: 'word', tok: 'word', sent: 's_type' }).socialcalc;
  const exported = exportSpannotatorData({
    format: 'socialcalc',
    tokens: imported.tokens,
    tokensById: Object.fromEntries(imported.tokens.map((tok) => [tok.tid, tok])),
    entities: imported.entities,
    groups: imported.groups,
    summaries: imported.summaries,
    socialcalc: baseSocialcalc,
    config: { sent: 's_type' }
  });

  assert.match(exported, /cell:[A-Z]+1:t:s_type:f:2(?:[:].*)?$/m);
  assert.match(exported, /cell:[A-Z]+2:t:s_type:f:1:tvf:1:rowspan:2/m);

  const reimported = importSpannotatorData(exported, { word: 'word', tok: 'word', sent: 's_type' });
  assert.deepEqual(reimported.tokens.map((tok) => tok.sentnum), [1, 1, 2]);
});

test('WebAnno import preserves existing sentence values when spans already match', () => {
  const webannoRaw = [
    '#FORMAT=WebAnno TSV 3.2',
    '#T_SP=webanno.custom.Referent|entity|infstat|salience',
    '#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent',
    '',
    '#Text=Alpha Beta',
    '1-1\t0-5\tAlpha\t_\t_\t_\t_\t_',
    '1-2\t6-10\tBeta\t_\t_\t_\t_\t_',
    '',
    '#Text=Gamma',
    '2-1\t11-16\tGamma\t_\t_\t_\t_\t_'
  ].join('\n');

  const imported = importSpannotatorData(webannoRaw, { sent: 's_type' });

  const existingSheetRaw = [
    'socialcalc:version:1.0',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    '# SocialCalc Spreadsheet Control Save',
    'version:1.0',
    'part:sheet',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    'version:1.5',
    'cell:A1:t:word:f:2',
    'cell:B1:t:s_type:f:2',
    'cell:A2:t:Alpha:f:1:tvf:1',
    'cell:A3:t:Beta:f:1:tvf:1',
    'cell:A4:t:Gamma:f:1:tvf:1',
    'cell:B2:t:decl:f:1:tvf:1:rowspan:2',
    'cell:B4:t:frag:f:1:tvf:1',
    'sheet:c:2:r:4:tvf:2',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '--SocialCalcSpreadsheetControlSave--'
  ].join('\n');

  const baseSocialcalc = importSpannotatorData(existingSheetRaw, { word: 'word', tok: 'word', sent: 's_type' }).socialcalc;
  const exported = exportSpannotatorData({
    format: 'socialcalc',
    tokens: imported.tokens,
    tokensById: Object.fromEntries(imported.tokens.map((tok) => [tok.tid, tok])),
    entities: imported.entities,
    groups: imported.groups,
    summaries: imported.summaries,
    socialcalc: baseSocialcalc,
    config: { sent: 's_type' }
  });

  assert.ok(exported.includes('cell:B2:t:decl:f:1:tvf:1:rowspan:2'));
  assert.ok(exported.includes('cell:B4:t:frag:f:1:tvf:1'));
  assert.ok(!exported.includes('cell:B2:t:s_type:f:1:tvf:1:rowspan:2'));
});

test('WebAnno import overwrites sentence column when existing spans conflict', () => {
  const webannoRaw = [
    '#FORMAT=WebAnno TSV 3.2',
    '#T_SP=webanno.custom.Referent|entity|infstat|salience',
    '#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent',
    '',
    '#Text=Alpha Beta',
    '1-1\t0-5\tAlpha\t_\t_\t_\t_\t_',
    '1-2\t6-10\tBeta\t_\t_\t_\t_\t_',
    '',
    '#Text=Gamma',
    '2-1\t11-16\tGamma\t_\t_\t_\t_\t_'
  ].join('\n');

  const imported = importSpannotatorData(webannoRaw, { sent: 's_type' });

  const conflictingSheetRaw = [
    'socialcalc:version:1.0',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    '# SocialCalc Spreadsheet Control Save',
    'version:1.0',
    'part:sheet',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    'version:1.5',
    'cell:A1:t:word:f:2',
    'cell:B1:t:s_type:f:2',
    'cell:A2:t:Alpha:f:1:tvf:1',
    'cell:A3:t:Beta:f:1:tvf:1',
    'cell:A4:t:Gamma:f:1:tvf:1',
    'cell:B2:t:decl:f:1:tvf:1',
    'cell:B3:t:frag:f:1:tvf:1:rowspan:2',
    'sheet:c:2:r:4:tvf:2',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '--SocialCalcSpreadsheetControlSave--'
  ].join('\n');

  const baseSocialcalc = importSpannotatorData(conflictingSheetRaw, { word: 'word', tok: 'word', sent: 's_type' }).socialcalc;
  const exported = exportSpannotatorData({
    format: 'socialcalc',
    tokens: imported.tokens,
    tokensById: Object.fromEntries(imported.tokens.map((tok) => [tok.tid, tok])),
    entities: imported.entities,
    groups: imported.groups,
    summaries: imported.summaries,
    socialcalc: baseSocialcalc,
    config: { sent: 's_type' }
  });

  assert.ok(exported.includes('cell:B2:t:s_type:f:1:tvf:1:rowspan:2'));
  assert.ok(exported.includes('cell:B4:t:s_type:f:1:tvf:1'));
  assert.ok(!exported.includes('cell:B3:t:frag:f:1:tvf:1:rowspan:2'));
});

test('WebAnno sentence spans are inferred from X-1 token IDs, not entity spans', () => {
  const webannoRaw = [
    '#FORMAT=WebAnno TSV 3.2',
    '#T_SP=webanno.custom.Referent|entity|infstat|salience|identity',
    '#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent',
    '',
    '#Text=First sentence Bob !',
    '1-1\t0-5\tFirst\tabstract[1]\tnew[1]\tnnnnn[1]\t_\t_\t_\t',
    '1-2\t6-14\tsentence\tabstract[1]\tnew[1]\tnnnnn[1]\t_\t_\t_\t',
    '1-3\t15-18\tBob\tperson[2]\tnew[2]\tnnnnn[2]\tBobby_Flay[2]\t_\t_\t',
    '1-4\t19-20\t!\t_\t_\t_\t_\t_\t_\t',
    '',
    '#Text=This is the second sentence .',
    '2-1\t21-25\tThis\tabstract[3]\tnew[3]\tnnnnn[3]\t_\tcoref\t2-3[4_3]\t',
    '2-2\t26-28\tis\t_\t_\t_\t_\t_\t_\t',
    '2-3\t29-32\tthe\tabstract[4]\tgiv[4]\tnnnnn[4]\t_\t_\t_\t',
    '2-4\t33-39\tsecond\tabstract[4]\tgiv[4]\tnnnnn[4]\t_\t_\t_\t',
    '2-5\t40-48\tsentence\tabstract[4]\tgiv[4]\tnnnnn[4]\t_\t_\t_\t',
    '2-6\t49-50\t.\t_\t_\t_\t_\t_\t_\t'
  ].join('\n');

  const imported = importSpannotatorData(webannoRaw, { sent: 's_type' });

  const emptySheetRaw = [
    'socialcalc:version:1.0',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    '# SocialCalc Spreadsheet Control Save',
    'version:1.0',
    'part:sheet',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    'version:1.5',
    'cell:A1:t:word:f:2',
    ...imported.tokens.map((tok, idx) => `cell:A${idx + 2}:t:${tok.word}:f:1:tvf:1`),
    `sheet:c:1:r:${imported.tokens.length + 1}:tvf:2`,
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '--SocialCalcSpreadsheetControlSave--'
  ].join('\n');

  const baseSocialcalc = importSpannotatorData(emptySheetRaw, { word: 'word', tok: 'word', sent: 's_type' }).socialcalc;
  const exported = exportSpannotatorData({
    format: 'socialcalc',
    tokens: imported.tokens,
    tokensById: Object.fromEntries(imported.tokens.map((tok) => [tok.tid, tok])),
    entities: imported.entities,
    groups: imported.groups,
    summaries: imported.summaries,
    socialcalc: baseSocialcalc,
    config: { sent: 's_type' }
  });

  // Sentence 1 spans 4 tokens (rows 2-5), sentence 2 spans 6 tokens (rows 6-11).
  assert.match(exported, /cell:[A-Z]+2:t:s_type:f:1:tvf:1:rowspan:4/);
  assert.match(exported, /cell:[A-Z]+6:t:s_type:f:1:tvf:1:rowspan:6/);

  const lines = exported.split('\n');
  const sentenceHeaderCount = lines.filter((line) => /cell:[A-Z]+1:t:s_type:f:2/.test(line)).length;
  const sentenceDataCount = lines.filter((line) => /cell:[A-Z]+\d+:t:s_type:f:1:tvf:1(?::rowspan:\d+)?$/.test(line)).length;
  assert.equal(sentenceHeaderCount, 1, 'Expected exactly one sentence header column for s_type');
  assert.equal(sentenceDataCount, 2, 'Expected exactly two sentence span cells for two WebAnno sentences');
});

test('SocialCalc export compacts redundant managed columns and updates sheet column count', () => {
  const redundantRaw = [
    'socialcalc:version:1.0',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    '# SocialCalc Spreadsheet Control Save',
    'version:1.0',
    'part:sheet',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    'version:1.5',
    'cell:A1:t:tok:f:2',
    'cell:B1:t:pos:f:2',
    'cell:C1:t:entity:f:2',
    'cell:D1:t:entity:f:2',
    'cell:E1:t:infstat:f:2',
    'cell:F1:t:infstat:f:2',
    'cell:G1:t:ent_id:f:2',
    'cell:H1:t:ent_id:f:2',
    'cell:A2:t:Alice:f:1:tvf:1',
    'cell:B2:t:NP:f:1:tvf:1',
    'cell:D2:t:person:f:1:tvf:1',
    'cell:F2:t:new:f:1:tvf:1',
    'cell:H2:t:9:f:1:tvf:1',
    'cell:A3:t:runs:f:1:tvf:1',
    'cell:B3:t:VBZ:f:1:tvf:1',
    'sheet:c:8:r:3:tvf:2',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '--SocialCalcSpreadsheetControlSave--'
  ].join('\n');

  const imported = importSpannotatorData(redundantRaw);
  const exported = exportSpannotatorData({
    format: 'socialcalc',
    tokens: imported.tokens,
    tokensById: Object.fromEntries(imported.tokens.map((tok) => [tok.tid, tok])),
    entities: imported.entities,
    groups: imported.groups,
    summaries: imported.summaries,
    socialcalc: imported.socialcalc
  });

  const lines = exported.split('\n');
  const entityHeaders = lines.filter((line) => /^cell:[A-Z]+1:t:entity:f:2(?::[^\n]*)?$/.test(line));
  const infstatHeaders = lines.filter((line) => /^cell:[A-Z]+1:t:infstat:f:2(?::[^\n]*)?$/.test(line));
  const entIdHeaders = lines.filter((line) => /^cell:[A-Z]+1:t:ent_id:f:2(?::[^\n]*)?$/.test(line));

  assert.equal(entityHeaders.length, 1, 'Expected one entity column after compaction');
  assert.equal(infstatHeaders.length, 1, 'Expected one infstat column after compaction');
  assert.equal(entIdHeaders.length, 1, 'Expected one ent_id column after compaction');

  assert.ok(exported.includes('cell:C2:t:person:f:1:tvf:1'));
  assert.ok(exported.includes('cell:D2:t:new:f:1:tvf:1'));
  assert.ok(exported.includes('cell:E2:t:9:f:1:tvf:1'));

  assert.ok(exported.includes('sheet:c:11:r:3:tvf:2'), 'Expected sheet:c to reflect compacted live columns');
});

test('SocialCalc export does not emit empty annotation columns when annotations stay at defaults', () => {
  const raw = [
    'cell:A1:t:tok:f:2',
    'cell:B1:t:entity:f:2',
    'cell:C1:t:identity:f:2',
    'cell:A2:t:John:f:1:tvf:1',
    'cell:B2:t:person:f:1:tvf:1',
    'cell:C2:t:john_01:f:1:tvf:1',
    'cell:A3:t:Mary:f:1:tvf:1',
    'cell:B3:t:person:f:1:tvf:1',
    'cell:C3:t:mary_01:f:1:tvf:1',
    'sheet:c:3:r:3:tvf:2'
  ].join('\n');

  const bootstrapRaw = [
    'socialcalc:version:1.0',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    '# SocialCalc Spreadsheet Control Save',
    'version:1.0',
    'part:sheet',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    'version:1.5',
    'cell:A1:t:word:f:2',
    'cell:A2:t:John:f:1:tvf:1',
    'cell:A3:t:Mary:f:1:tvf:1',
    'sheet:c:1:r:3:tvf:2',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '--SocialCalcSpreadsheetControlSave--'
  ].join('\n');

  const imported = importSpannotatorData(bootstrapRaw, { word: 'word', tok: 'word' });
  const exported = exportSpannotatorData({
    format: 'socialcalc',
    tokens: imported.tokens,
    tokensById: Object.fromEntries(imported.tokens.map((tok) => [tok.tid, tok])),
    entities: imported.entities,
    groups: imported.groups,
    summaries: imported.summaries,
    socialcalc: imported.socialcalc
  });

  const lines = exported.split('\n');
  assert.equal(lines.some((line) => /cell:[A-Z]+1:t:char_offset:f:2/.test(line)), false, 'Did not expect a char_offset header');
  assert.equal(lines.some((line) => /cell:[A-Z]+1:t:infstat:f:2/.test(line)), false, 'Did not expect an infstat header');
  assert.equal(lines.some((line) => /cell:[A-Z]+1:t:salience:f:2/.test(line)), false, 'Did not expect a salience header');
  assert.equal(lines.some((line) => /cell:[A-Z]+1:t:bridgetype:f:2/.test(line)), false, 'Did not expect a bridgetype header');
});

test('SocialCalc import does not bleed secondary group mode from merged parent into nested slot', () => {
  const raw = [
    'socialcalc:version:1.0',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    '# SocialCalc Spreadsheet Control Save',
    'version:1.0',
    'part:sheet',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '',
    'version:1.5',
    'cell:A1:t:word:f:2',
    'cell:C1:t:entity:f:2',
    'cell:D1:t:entity:f:2',
    'cell:E1:t:group\\ccoref:f:2',
    'cell:F1:t:group\\ccoref:f:2',
    'cell:G1:t:group\\csplit:f:2',
    'cell:A2:t:w1:f:1:tvf:1',
    'cell:A3:t:w2:f:1:tvf:1',
    'cell:A4:t:w3:f:1:tvf:1',
    'cell:A5:t:w4:f:1:tvf:1',
    'cell:A6:t:w5:f:1:tvf:1',
    'cell:C2:t:person:f:1:tvf:1:rowspan:3',
    'cell:C6:t:person:f:1:tvf:1',
    'cell:D3:t:person:f:1:tvf:1',
    'cell:E2:t:1:f:1:tvf:1:rowspan:3',
    'cell:E6:t:1:f:1:tvf:1',
    'cell:G2:t:7:f:1:tvf:1:rowspan:3',
    'cell:G6:t:7:f:1:tvf:1',
    'sheet:c:7:r:6:tvf:2',
    '--SocialCalcSpreadsheetControlSave',
    'Content-type: text/plain; charset=UTF-8',
    '--SocialCalcSpreadsheetControlSave--'
  ].join('\n');

  const imported = importSpannotatorData(raw, {
    GROUP_TYPES: ['coref', 'split'],
    EDGE_TYPES: [],
    word: 'word',
    tok: 'word'
  });

  const child = imported.entities['2-2'];
  const parent = imported.entities['1-3'];
  const peer = imported.entities['5-5'];

  assert.ok(child, 'Expected nested child entity at 2-2');
  assert.ok(parent, 'Expected parent entity at 1-3');
  assert.ok(peer, 'Expected peer entity at 5-5');

  assert.equal(Number(parent.groups.split || 0) > 0, true, 'Parent should remain in non-zero split group');
  assert.equal(Number(peer.groups.split || 0) > 0, true, 'Peer should remain in non-zero split group');
  assert.equal(Number(child.groups.split || 0), 0, 'Nested child must not inherit split group from merged parent slot cell');
});

test('WebAnno import of star-topology group-type edges clusters all members correctly', () => {
  // Two entities (352, 358) each have a split edge pointing FROM a third entity (364) TO them.
  // This is a star pattern: 364 -> 352 and 364 -> 358.
  // All three must end up in the same split cluster. Neither span may be silently dropped.
  const raw = [
    '#FORMAT=WebAnno TSV 3.2',
    '#T_SP=webanno.custom.Referent|entity|infstat|salience|identity',
    '#T_RL=webanno.custom.Coref|type|BT_webanno.custom.Referent',
    '',
    '#Text=Alpha Beta',
    '1-1\t0-5\tAlpha\tabstract[352]\tnew[352]\tnnnnn[352]\t_[352]\tsplit\t3-1[364_352]\t',
    '1-2\t6-10\tBeta\t_\t_\t_\t_\t_\t_\t',
    '',
    '#Text=Gamma Delta Epsilon',
    '2-1\t11-16\tGamma\tabstract[358]\tacc[358]\tnnnnn[358]\t_[358]\tsplit\t3-1[364_358]\t',
    '2-2\t17-22\tDelta\tabstract[358]\tacc[358]\tnnnnn[358]\t_[358]\t_\t_\t',
    '2-3\t23-30\tEpsilon\t_\t_\t_\t_\t_\t_\t',
    '',
    '#Text=These',
    '3-1\t31-36\tThese\tabstract[364]\tsplit[364]\tnnnnn[364]\t_[364]\t_\t_\t'
  ].join('\n');

  const cfg = {
    GROUP_TYPES: ['coref', 'split'],
    EDGE_TYPES: []
  };

  const imported = importSpannotatorData(raw, cfg);
  assertStateInvariants({
    tokens: imported.tokens,
    entitiesById: imported.entities,
    groupsByType: imported.groups,
    assignedColors: imported.assignedColors,
    config: buildSpannotatorConfig(cfg),
    uiState: { selectedTokens: new Set(), selectedEntities: new Set(), dialogs: {} }
  }, { throwOnError: false });

  // Locate the three entities by their token ranges.
  const div352 = Object.values(imported.entities).find((e) => e.toks.includes(1));
  const div358 = Object.values(imported.entities).find((e) => e.toks.includes(4));
  const div364 = Object.values(imported.entities).find((e) => e.toks.includes(6));

  assert.ok(div352, 'Entity 352 (tok 1) must be present');
  assert.ok(div358, 'Entity 358 (tok 4) must be present');
  assert.ok(div364, 'Entity 364 (tok 6) must be present');

  const g352 = Number(div352.groups.split || 0);
  const g358 = Number(div358.groups.split || 0);
  const g364 = Number(div364.groups.split || 0);

  assert.ok(g352 > 0, 'Entity 352 must be in a non-zero split group');
  assert.ok(g358 > 0, 'Entity 358 must be in a non-zero split group');
  assert.ok(g364 > 0, 'Entity 364 must be in a non-zero split group');
  assert.equal(g352, g358, 'Entities 352 and 358 must share the same split group');
  assert.equal(g358, g364, 'Entities 358 and 364 must share the same split group');

  // No entity should have a split antecedent (split is a group type, not an edge type).
  assert.equal(div352.antecedents?.split, undefined, 'Entity 352 must not have a split antecedent');
  assert.equal(div358.antecedents?.split, undefined, 'Entity 358 must not have a split antecedent');
  assert.equal(div364.antecedents?.split, undefined, 'Entity 364 must not have a split antecedent');
});
