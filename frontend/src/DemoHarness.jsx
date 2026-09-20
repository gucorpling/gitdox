/*
* @file Demo Harness for the GitDOX editor widgets with mock backend calls and sample data
* @author Amir Zeldes 
*/

import { useState, useEffect, useCallback } from 'react';
import { Settings, Copy, RefreshCw, Code, Check } from 'lucide-react';
import { buildXmlCompletionConfig, normalizeFontFamily } from './appShared';

import { Dendroid } from './components/Dendroid';
import SpreadsheetEditor from './components/SpreadsheetEditor'; 
import XmlEditor from './components/XmlEditor';
import Spannotator from './components/Spannotator';

import {SAMPLE_SOCIALCALC, SAMPLE_XML} from './demo-data.js';

// --- 1. MOCK DATA & CONFIGS ---

const INITIAL_CONFIG = {
  ui: {
    font: 'Roboto, "Lucida Grande", "Lucida Sans Unicode", "Lucida Sans", "DejaVu Sans", Verdana, sans-serif'
  },
  dendroid: {
    currentUser: "DemoUser",
    defaultAnnotator: "Parser",
    perUserMode: true,
    token_annotations: {
      word_id: 'uid',
      word: 'tok',
      lemma: 'lemma',
      xpos: 'xpos',
      upos: 'upos',
      feats: 'feats',
      head: 'head',
      deprel: 'deprel',
      edeps: 'edeps',
      misc: 'misc',
      mwt: 'mwt'
    },
    features: { mwt: true, ellipsis: true, edeps: true, feats: true, misc: true, hide_duplicate_edeps: true }
  },
  spreadsheet: {
    column_order: ['tok', 'word', 'text_id', 'p', 'hi_rend', 's_type', 'lemma', 'upos', 'xpos', 'word_id', 'head', 'deprel', 'deps', 'misc', 'mwt', 'dendroid:annotator'],
    font: "Times New Roman"
  },
  xml: {
    autoIndent: true,
    fontFamily: "monospace",
    tags_schema: {"!top":["text"],"text":{"attrs":{"id":null},"children":["figure","list","p","table","quote","s","head","sp","incident"]},"head":{"attrs":{"rend":null},"children":["s","hi","foreign","q","w"]},"lg":{"attrs":{"type":null,"n":null},"children":["s"]},"note":{"attrs":{"place":null,"n":null},"children":["s"]},"sp":{"attrs":{"place":null,"upvotes":null,"when":null,"who":null,"whom":null},"children":["s","head","list","p","w","hi","foreign","sic","gap","incident","date","time","quote","q"]},"s":{"attrs":{"type":["decl","sub","imp","q","wh","inf","ger","intj","frag","other","multiple"]},"children":["add","row","figure","hi","foreign","sp","q","cell","w","quote","ref","date","gap","incident","l","list","supplied","sic","time"]},"incident":{"attrs":{"type":null,"who":null},"children":["date","sic"]},"date":{"attrs":{"from":null,"notAfter":null,"notBefore":null,"rend":null,"to":null,"when":null},"children":["w","sic"]},"supplied":{"attrs":{"reason":null}},"gap":{"attrs":{"reason":null}},"measure":{"attrs":{"type":null}},"sic":{"attrs":{"ana":null},"children":["ref","w","hi"]},"w":{"children":["sic","q","hi"]},"time":{"attrs":{"when":null,"from":null,"to":null,"notBefore":null,"notAfter":null}},"quote":{"attrs":{"rend":null},"children":["add","q","date","p","w","ref","hi","foreign","s","gap","sic"]},"figure":{"attrs":{"rend":null},"children":["caption"]},"caption":{"attrs":{"rend":null},"children":["quote","q","w","ref","hi","foreign","s"]},"p":{"attrs":{"rend":null},"children":["add","supplied","gap","figure","hi","foreign","lg","note","quote","list","time","ref","incident","date","sic","w","q","s","sp"]},"table":{"attrs":{"rend":null,"rows":null,"cols":null},"children":["head","row","s"]},"row":{"attrs":{"n":null},"children":["cell","s"]},"cell":{"attrs":{"n":null,"rend":null,"role":null},"children":["figure","date","list","ref","hi","foreign","s"]},"list":{"attrs":{"type":["ordered","unordered"]},"children":["figure","item"]},"item":{"attrs":{"n":null},"children":["head","figure","ref","hi","foreign","list","p","s"]},"add":{"children":["s","ref"]},"l":{"attrs":{"n":null},"children":["s","date"]},"hi":{"attrs":{"rend":null},"children":["ref","figure","incident","w","lg","s","caption","q","sic","date","foreign"]},"foreign":{"attrs":{"xml:lang":null},"children":["ref","figure","incident","w","lg","s","caption","q","sic","date","hi"]},"q":{"children":["figure","hi","foreign","w","sic","ref"]},"ref":{"attrs":{"target":null,"rend":null},"children":["add","w","hi","foreign","sic","date","q"]}}
  },
  entities: {
    font: "Times New Roman",
    show_entity_linking: true,
    guess_identities: true,
    first_mentions: true,
    annotations: {
      entity: { identity: 'identity',
                ner_pos: {xpos: ['NNP', 'NNPS', 'NP', 'NPS', 'NPROP']}
      },
      keys: {
        infstat: {
          values: ['auto', 'new', 'acc', 'giv', 'split'],
          stars: {"acc":"yellow","split":"green"}
        }
      },
      checks: {
        salience: [5,'n','s']
      }
    },
    carousel:{
      keys: ["Summary1","Summary2","Summary3","Summary4","Summary5"],
      sync: "salience"
    },
    colors: {
      groups: {"coref": ["chain", "sametype"], "split": ["star","anytype"]},
      edges: {
        bridge: {
          bridgetype: ["nobridge","comparison-relative","comparison-sense","comparison-time","entity-associative","entity-meronymy","entity-property","entity-resultative","set-member","set-subset","set-span-interval","other"],
          show_coarse: true
        },
      }

    },
    sentences: 's_type',
    sentence_mode: true,
    default_color_mode: "coref",
    webanno_order: ['entity', 'infstat', 'salience', 'identity']
  }
};



// --- 2. ADAPTERS ---

function DendroidAdapter({ content, format, config, fontFamily, onChange }) {
  const getTokenAnn = (key, defaultVal) => {
    const val = config?.token_annotations?.[key];
    return val !== undefined ? val : defaultVal;
  };
  return (
    <div style={{ fontFamily: fontFamily || undefined }} className="h-full w-full flex-1">
      <Dendroid 
        initialData={content}
        initialFormat={format}
        currentUser={config.currentUser}
        defaultAnnotator={config.defaultAnnotator}
        perUserMode={config.perUserMode}
        features={config.features}
        onChange={onChange}
        colMappings={{
          id: getTokenAnn('word_id', 'word_id'),
          form: getTokenAnn('word', 'tok'),
          lemma: getTokenAnn('lemma', 'lemma'),
          upos: getTokenAnn('upos', 'upos'),
          xpos: getTokenAnn('xpos', 'xpos'),
          feats: getTokenAnn('feats', 'feats'),
          head: getTokenAnn('head', 'head'),
          deprel: getTokenAnn('deprel', 'deprel'),
          deps: getTokenAnn('edeps', 'deps'),
          misc: getTokenAnn('misc', 'misc'),
          annotator: 'dendroid:annotator',
          mwt: config?.mwt || ''
        }}
      />
    </div>
  );
}

function SpreadsheetAdapter({ content, config, onChange, mockApiCall, fontFamily }) {
  return (
    <SpreadsheetEditor
      value={content}
      apiCall={mockApiCall}
      onChange={onChange}
      onCanonicalized={onChange}
      docId="demo-doc-123"
      preferredColumnOrder={config.column_order}
      fontFamily={fontFamily}
      className="h-full w-full"
    />
  );
}

function XmlAdapter({ content, config, onChange, fontFamily }) {
  return (
    <XmlEditor
      value={content}
      onChange={onChange}
      xmlAutoIndent={config.autoIndent}
      fontFamily={fontFamily}
      xmlTagCompletion={buildXmlCompletionConfig(config.tags_schema)}
      mutationTools={{}}
      user={{ username: 'DemoUser', adminlevel: 3 }}
      activeMutationTool=""
      onRunMutationTool={async (tool) => alert(`Mock mutation tool: ${tool}`)}
    />
  );
}

function SpannotatorAdapter({ content, config, onChange, fontFamily }) {
  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden relative">
      <div className="flex-1 overflow-hidden relative bg-white">
        <Spannotator
          value={content}
          config={config}
          onChange={onChange}
          canDataTransfer={true}
          fontFamily={fontFamily}
          className="h-full w-full absolute inset-0 overflow-y-auto"
          externalControlsHostId="demo-entities-controls-host"
          
          // --- MOCK NLP / BACKEND CALLS ---
          onImportSgml={async (sgml) => {
            if (String(sgml).includes('socialcalc:version')) return sgml;
            alert("SGML/WebAnno conversion requires the Python backend. Please paste valid SocialCalc data in the demo.");
            throw new Error("Backend required");
          }}
          mutationTools={{
            mockTool: { editor: 'entities', caption: 'Test External Tool', color: 'indigo' }
          }}
          onRunTool={async (toolKey) => {
            await new Promise(r => setTimeout(r, 500));
            alert(`Mocking tool execution: ${toolKey}`);
            return content; // Echo content back so it doesn't crash
          }}
          onGuessIdentities={async (entityPairs) => {
            await new Promise(r => setTimeout(r, 600));
            // Return dummy Wikidata-style IDs based on the text
            return entityPairs.map(p => `Q_${p[0].replace(/\s+/g, '')}`);
          }}
          onFetchIdentitySuggestions={async (entityType) => {
            await new Promise(r => setTimeout(r, 300));
            return [`Mock_${entityType}_1`, `Mock_${entityType}_2`];
          }}
        />
      </div>
      {/* Portal target for the Named Entity Linking UI */}
      <div id="demo-entities-controls-host" className="shrink-0" />
    </div>
  );
}

// --- 3. DEMO HARNESS ---

const EDITOR_PARAM_WIDGETS = {
  dendroid: 'dendroid',
  spreadsheet: 'spreadsheet',
  xml: 'xml',
  spannotator: 'entities'
};

function getInitialWidget() {
  const editor = new URLSearchParams(window.location.search).get('editor');
  return EDITOR_PARAM_WIDGETS[editor] || 'dendroid';
}

export default function WidgetDemoHarness() {
  const [activeWidget, setActiveWidget] = useState(getInitialWidget);
  
  // Sandbox State
  const [contentSocialCalc, setContentSocialCalc] = useState(SAMPLE_SOCIALCALC);
  const [contentXml, setContentXml] = useState(SAMPLE_XML);
  const [format, setFormat] = useState('socialcalc'); 
  const [config, setConfig] = useState(INITIAL_CONFIG);
  
  // UI State
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [configDraft, setConfigDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // MOCK API LAYER
  const mockApiCall = useCallback(async (endpoint, method = 'GET', payload = null) => {
    console.info(`[Mock API] ${method} ${endpoint}`, payload);
    await new Promise(resolve => setTimeout(resolve, 300));
    
    if (endpoint.endsWith('/validate')) {
      return { validation: { status: 'ready', results: [], message: 'Passed mock validation' } };
    }
    return {};
  }, []);

  useEffect(() => {
    if (isConfigOpen) setConfigDraft(JSON.stringify(config, null, 2));
  }, [isConfigOpen, config]);

  const handleApplyConfig = () => {
    try {
      setConfig(JSON.parse(configDraft));
      setIsConfigOpen(false);
    } catch (err) {
      alert("Invalid JSON configuration:\n" + err.message);
    }
  };

  const handleCopyOut = () => {
    const activeContent = activeWidget === 'xml' ? contentXml : contentSocialCalc;
    navigator.clipboard.writeText(activeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    if (confirm("Discard changes and reload sample data?")) {
      setContentSocialCalc(SAMPLE_SOCIALCALC);
      setContentXml(SAMPLE_XML);
      setFormat('socialcalc');
      setResetKey(k => k + 1); 
    }
  };
  
  const uiFont = normalizeFontFamily(config.ui?.font);
  const spreadsheetFont = normalizeFontFamily(config.spreadsheet?.font) || uiFont;
  const entitiesFont = normalizeFontFamily(config.entities?.font) || uiFont;
  const xmlFont = normalizeFontFamily(config.xml?.font) || uiFont;
  const dendroidFont = normalizeFontFamily(config.dendroid?.font) || uiFont;
  
  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100 overflow-hidden font-sans">
      <nav className="h-14 bg-slate-900 text-white flex items-center justify-between px-4 shrink-0 shadow-md z-10">
        <div className="flex items-center gap-4">
          <div className="font-bold tracking-wide flex items-center gap-2">
            <Code size={20} className="text-indigo-400" />
            GitDOX Demo
          </div>
          
          <select 
            className="bg-slate-800 border border-slate-700 text-sm rounded px-2 py-1 outline-none focus:border-indigo-500"
            value={activeWidget}
            onChange={(e) => setActiveWidget(e.target.value)}
          >
            <option value="dendroid">Syntax</option>
            <option value="entities">Entities</option>
            <option value="spreadsheet">Spreadsheet</option>
            <option value="xml">XML Editor</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleReset} className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded transition-colors" title="Reset to default data">
            <RefreshCw size={16} /> Reset
          </button>
          <button onClick={() => setIsConfigOpen(true)} className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded transition-colors" title="Widget Settings">
            <Settings size={16} /> Config
          </button>
          <button onClick={handleCopyOut} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 rounded shadow-sm transition-colors ml-2">
            {copied ? <Check size={16} /> : <Copy size={16} />} 
            {copied ? 'Copied!' : 'Export / Copy'}
          </button>
        </div>
      </nav>

      <main className="flex-1 relative flex min-h-0">
        <div className="flex-1 h-full min-w-0 min-h-0 flex flex-col bg-white">
          
          {activeWidget === 'dendroid' && (
             <DendroidAdapter 
               key={`dendroid-${resetKey}`} 
               content={contentSocialCalc}
               format={format}
               config={config.dendroid} 
               fontFamily={dendroidFont}
               onChange={(newContent) => {
                 setContentSocialCalc(newContent);
                 setFormat('socialcalc'); 
               }} 
             />
          )}

          {activeWidget === 'entities' && (
             <SpannotatorAdapter 
               key={`entities-${resetKey}`} 
               content={contentSocialCalc}
               config={config.entities} 
               fontFamily={entitiesFont}
               onChange={(newContent) => {
                 setContentSocialCalc(newContent);
                 setFormat('socialcalc'); 
               }} 
             />
          )}

          {activeWidget === 'spreadsheet' && (
            <SpreadsheetAdapter 
              key={`spreadsheet-${resetKey}`}
              content={contentSocialCalc}
              fontFamily={spreadsheetFont}
              config={config.spreadsheet}
              mockApiCall={mockApiCall}
              onChange={(newContent) => {
                setContentSocialCalc(newContent);
                setFormat('socialcalc');
              }}
            />
          )}

          {activeWidget === 'xml' && (
            <XmlAdapter 
              key={`xml-${resetKey}`}
              content={contentXml}
              fontFamily={xmlFont}
              config={config.xml}
              onChange={setContentXml}
            />
          )}
        </div>

        {isConfigOpen && (
          <div className="w-96 h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col z-20 animate-in slide-in-from-right-8 duration-200">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                <Settings size={18} /> Demo Config
              </h2>
              <button onClick={() => setIsConfigOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            
            <div className="flex-1 p-4 flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase">Live JSON Configuration</label>
              <textarea 
                value={configDraft}
                onChange={(e) => setConfigDraft(e.target.value)}
                className="flex-1 w-full p-3 font-mono text-xs bg-slate-900 text-green-400 rounded outline-none focus:ring-2 focus:ring-indigo-500 resize-none whitespace-pre"
                spellCheck={false}
              />
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-2 justify-end">
              <button onClick={() => setIsConfigOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded">Cancel</button>
              <button onClick={handleApplyConfig} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm">Apply Changes</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
