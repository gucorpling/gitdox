import { useState, useMemo, useRef } from 'react';
import { Code, X } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { xml } from '@codemirror/lang-xml';
import { insertNewline } from '@codemirror/commands';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';

export default function XmlEditor({
  value,
  onChange,
  xmlAutoIndent,
  xmlTagCompletion,
  lineWrapping,
  fontFamily,
  schemaWarning,
  mutationTools,
  user,
  activeMutationTool,
  onRunMutationTool
}) {
  const cmRef = useRef(null);
  const [xmlTagModalOpen, setXmlTagModalOpen] = useState(false);
  const [xmlTagForm, setXmlTagForm] = useState({ tag: '', attr: '', val: '' });

  const xmlEditorExtensions = useMemo(() => {
    const extensions = [];

    extensions.push(
      keymap.of([
        {
          key: 'Ctrl-e', 
          mac: 'Cmd-e', 
          run: () => {
            setXmlTagModalOpen(true);
            return true;
          }
        }
      ])
    );

    if (!xmlAutoIndent) {
      extensions.push(
        Prec.highest(
          keymap.of([
            { key: 'Enter', run: insertNewline, shift: insertNewline }
          ])
        )
      );
    }

    if (xmlTagCompletion?.elements?.length) {
      extensions.push(xml(xmlTagCompletion));
    } else {
      extensions.push(xml());
    }

    // Add word wrap if desired using extensions={[EditorView.lineWrapping]}
    if (lineWrapping) {
      extensions.push(EditorView.lineWrapping);
    }

    return extensions;
  }, [xmlAutoIndent, xmlTagCompletion, lineWrapping]);

  const handleInsertXmlTag = (e) => {
    e.preventDefault();
    const { tag, attr, val } = xmlTagForm;
    const cleanTag = tag.trim();
    
    // Disable OK if no tag
    if (!cleanTag) return;

    if (cmRef.current && cmRef.current.view) {
      const view = cmRef.current.view;
      const state = view.state;
      const selection = state.selection.main;
      const selectedText = state.sliceDoc(selection.from, selection.to);

      // Build the tags
      let openTag = `<${cleanTag}`;
      if (attr.trim()) {
        openTag += ` ${attr.trim()}="${val.trim()}"`;
      }
      openTag += '>';
      const closeTag = `</${cleanTag}>`;

      // Dispatch the change directly to CodeMirror
      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: openTag + selectedText + closeTag
        },
        // Leave the wrapped text selected afterward
        selection: { 
          anchor: selection.from + openTag.length, 
          head: selection.from + openTag.length + selectedText.length 
        }
      });
      
      // Refocus the editor
      view.focus();
    }
    setXmlTagModalOpen(false);
  };

  return (
    <div className="flex-1 bg-white pt-10 flex flex-col min-h-0">
      {schemaWarning && (
        <div className="mx-4 mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          XML tag schema warning: {schemaWarning}
        </div>
      )}
      <div className="flex-1 overflow-auto xml-editor-host" style={fontFamily ? { '--xml-editor-font-family': fontFamily } : undefined}>
        <CodeMirror
          ref={cmRef}
          value={value}
          height="100%"
          extensions={xmlEditorExtensions}
          basicSetup={xmlAutoIndent ? true : { indentOnInput: false }}
          onChange={onChange}
          className="h-full text-sm border-t border-slate-100"
        />
      </div>
      {/* 2. XML toolbar button */}
      <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-2 bg-slate-50">
        <button
          type="button"
          onClick={() => setXmlTagModalOpen(true)}
          title="Insert XML Element (Ctrl+E)"
          className="p-1.5 mr-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-100 rounded transition-colors bg-white border border-slate-200 shadow-sm"
        >
          <Code size={18} />
        </button>
        {/* ----------------------- */}               
        {Object.entries(mutationTools || {}).map(([toolKey, config]) => {
          // 1. Check if the tool belongs to the XML editor
          if (config.editor !== 'xml') return null;

          // 2. Check if the user has the required admin level
          const requiredLevel = config.level || 0;
          const userLevel = user?.adminlevel || 0;
          if (userLevel < requiredLevel) return null;

          // 3. Render the dynamic button
          return (
            <button
              key={toolKey}
              type="button"
              style={config.color ? { backgroundColor: config.color } : undefined}
              onClick={() => onRunMutationTool(toolKey, config)}
              disabled={!!activeMutationTool}
              className="px-3 py-1.5 text-sm font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {activeMutationTool === toolKey ? `${config.caption}...` : config.caption}
            </button>
          );
        })}
      </div>

      {/* XML Tag Insertion Modal */}
      {xmlTagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl shadow-xl w-96 max-w-full m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-slate-800">Wrap with XML Tag</h3>
              <button onClick={() => setXmlTagModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleInsertXmlTag} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Tag Name</label>
                <input 
                  required 
                  autoFocus
                  className="w-full border border-slate-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                  placeholder="e.g. hi"
                  value={xmlTagForm.tag} 
                  onChange={e => setXmlTagForm({...xmlTagForm, tag: e.target.value})} 
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Attribute <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input 
                    className="w-full border border-slate-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    placeholder="e.g. rend"
                    value={xmlTagForm.attr} 
                    onChange={e => setXmlTagForm({...xmlTagForm, attr: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Value <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input 
                    className="w-full border border-slate-300 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    placeholder="e.g. italic"
                    value={xmlTagForm.val} 
                    onChange={e => setXmlTagForm({...xmlTagForm, val: e.target.value})} 
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={() => setXmlTagModalOpen(false)} 
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-md"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={!xmlTagForm.tag.trim()}
                  className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-md shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  OK
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
