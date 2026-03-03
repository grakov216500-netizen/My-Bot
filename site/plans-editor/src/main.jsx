/**
 * Novel-based rich text editor for Plans/Tasks.
 * Работает с JSON (TipTap), сохраняет через onSave(JSON_string).
 * Mounts into a container, exposes window.PlansEditor.mount()
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  EditorRoot,
  EditorContent,
  StarterKit,
  Placeholder,
  TiptapLink,
  TaskList,
  TaskItem,
} from 'novel';

/** Извлекает plain text из TipTap JSON для отображения в списке. */
export function jsonToPlainText(jsonOrStr) {
  if (!jsonOrStr) return '';
  let doc;
  try {
    doc = typeof jsonOrStr === 'string' ? JSON.parse(jsonOrStr) : jsonOrStr;
  } catch {
    return String(jsonOrStr);
  }
  if (!doc || typeof doc !== 'object') return '';
  function extract(n) {
    if (!n) return '';
    if (n.text) return n.text;
    if (Array.isArray(n.content)) return n.content.map(extract).join('');
    return '';
  }
  return (doc.content || []).map(extract).join(' ').trim() || '';
}

function PlansEditorWrapper({ initialContent, onSave, onCancel }) {
  const editorRef = React.useRef(null);
  const extensions = React.useMemo(
    () => [
      StarterKit,
      Placeholder,
      TiptapLink,
      TaskList,
      TaskItem,
    ],
    []
  );

  const contentToUse = React.useMemo(() => {
    if (initialContent === undefined || initialContent === null) return undefined;
    if (typeof initialContent === 'object') return initialContent;
    const s = String(initialContent).trim();
    if (!s) return undefined;
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  }, [initialContent]);

  const run = React.useCallback((fn) => {
    const e = editorRef.current;
    if (!e) return;
    fn(e);
  }, []);

  const handleSave = React.useCallback(() => {
    const e = editorRef.current;
    if (!e) return;
    const text = e.getText().trim();
    if (!text) return;
    const json = e.getJSON();
    const str = JSON.stringify(json);
    if (onSave && str) onSave(str);
  }, [onSave]);

  return (
    <div className="novel-plans-wrapper" style={{ marginTop: 8 }}>
      <EditorRoot>
        <div className="novel-toolbar">
          <button type="button" onClick={() => run((e) => e.chain().focus().toggleBold().run())}>Жирный</button>
          <button type="button" onClick={() => run((e) => e.chain().focus().toggleHeading({ level: 1 }).run())}>H1</button>
          <button type="button" onClick={() => run((e) => e.chain().focus().toggleBulletList().run())}>Список</button>
          <button type="button" onClick={() => run((e) => e.chain().focus().toggleTaskList().run())}>Чекбоксы</button>
        </div>
        <EditorContent
          extensions={extensions}
          initialContent={contentToUse}
          onUpdate={({ editor }) => { editorRef.current = editor; }}
          className="novel-plans-editor"
          editorProps={{
            attributes: {
              class: 'outline-none',
            },
          }}
        />
      </EditorRoot>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={handleSave}
          style={{ padding: '8px 16px', background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}
        >
          Сохранить
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{ padding: '8px 16px', background: '#334155', color: '#E2E8F0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
            Отмена
          </button>
        )}
      </div>
    </div>
  );
}

export function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').trim();
}

export function mountPlansEditor(containerEl, options = {}) {
  if (!containerEl) return null;
  const { initialContent = '', onSave, onCancel } = options;

  const root = ReactDOM.createRoot(containerEl);
  root.render(
    <PlansEditorWrapper
      initialContent={initialContent}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
  return {
    unmount: () => root.unmount(),
  };
}

if (typeof window !== 'undefined') {
  window.PlansEditor = { mount: mountPlansEditor, stripHtml, jsonToPlainText };
}
