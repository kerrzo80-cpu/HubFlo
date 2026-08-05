"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Bold, Italic, List, ListOrdered, Underline } from "lucide-react";
import {
  isEffectivelyEmptyHtml,
  looksLikeHtml,
  normalizeEditorHtml,
  plainTextToEditorHtml,
} from "@/lib/simpro-text";

export type DescriptionScript = {
  id: string;
  label: string;
  html: string;
};

export const DEFAULT_DESCRIPTION_SCRIPTS: DescriptionScript[] = [
  {
    id: "boiler-swap",
    label: "Boiler swap scope",
    html: "<p><strong>Boiler replacement</strong></p><ul><li>Isolate, drain and remove existing boiler</li><li>Install new boiler, flue and controls as specified</li><li>Refill, commission and leave system operational</li><li>Demonstrate operation and issue relevant certificates</li></ul>",
  },
  {
    id: "first-fix",
    label: "First fix plumbing",
    html: "<p><strong>First fix plumbing</strong></p><ul><li>Run hot and cold supplies to agreed locations</li><li>Install waste and soil connections ready for second fix</li><li>Pressure test and photograph concealed work</li><li>Cap services and leave area clean for follow-on trades</li></ul>",
  },
  {
    id: "second-fix",
    label: "Second fix &amp; commission",
    html: "<p><strong>Second fix and commissioning</strong></p><ul><li>Fit final sanitaryware / appliances</li><li>Connect, test and commission all services</li><li>Balance system and check for leaks</li><li>Clean down and complete handover with the customer</li></ul>",
  },
  {
    id: "service-visit",
    label: "Service / maintenance visit",
    html: "<p><strong>Service visit</strong></p><ul><li>Carry out manufacturer service checks</li><li>Inspect safety devices and record readings</li><li>Advise on any defects or recommended works</li><li>Leave appliance safe and issue paperwork</li></ul>",
  },
  {
    id: "engineer-notes",
    label: "Engineer private notes",
    html: "<p><strong>Private engineer notes</strong></p><ul><li>Access / parking notes</li><li>Isolation points and known risks</li><li>Parts to collect before attendance</li><li>Photos required before covering work</li></ul>",
  },
];

type SimproDescriptionEditorProps = {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  showScripts?: boolean;
  scripts?: DescriptionScript[];
  className?: string;
  minHeight?: number;
};

function toEditableHtml(value: string) {
  if (!value?.trim()) return "";
  if (looksLikeHtml(value)) return value;
  return plainTextToEditorHtml(value);
}

export function SimproDescriptionEditor({
  label,
  value,
  onChange,
  hint,
  showScripts = false,
  scripts = DEFAULT_DESCRIPTION_SCRIPTS,
  className = "",
  minHeight = 430,
}: SimproDescriptionEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef(value);
  const [fontSize, setFontSize] = useState("3");
  const scriptSelectId = useId();

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Avoid clobbering the caret while the user is typing into this surface.
    if (document.activeElement === editor && value === lastEmittedRef.current) return;
    const nextHtml = toEditableHtml(value);
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
    lastEmittedRef.current = value;
  }, [value]);

  function emitFromEditor() {
    const editor = editorRef.current;
    if (!editor) return;
    const raw = editor.innerHTML;
    const next = isEffectivelyEmptyHtml(raw) ? "" : normalizeEditorHtml(raw);
    lastEmittedRef.current = next;
    if (next !== value) onChange(next);
  }

  function runCommand(command: string, commandValue?: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    try {
      document.execCommand(command, false, commandValue);
    } catch {
      // Ignore unsupported commands; keep editor usable.
    }
    emitFromEditor();
  }

  function insertScript(scriptId: string) {
    if (!scriptId) return;
    const script = scripts.find((item) => item.id === scriptId);
    if (!script) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const separator = isEffectivelyEmptyHtml(editor.innerHTML) ? "" : "<p><br></p>";
    try {
      document.execCommand("insertHTML", false, `${separator}${script.html}`);
    } catch {
      editor.innerHTML = `${editor.innerHTML}${separator}${script.html}`;
    }
    emitFromEditor();
  }

  return (
    <div className={`simpro-editor-card ${className}`.trim()}>
      <div className="simpro-editor-header">
        <strong>
          {label}
          {hint ? <span> {hint}</span> : null}
        </strong>
        {showScripts ? (
          <select
            id={scriptSelectId}
            aria-label="Insert script"
            defaultValue=""
            onChange={(event) => {
              insertScript(event.target.value);
              event.currentTarget.value = "";
            }}
          >
            <option value="">Insert script</option>
            {scripts.map((script) => (
              <option key={script.id} value={script.id}>
                {script.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="simpro-editor-toolbar" role="toolbar" aria-label={`${label} formatting`}>
        <button type="button" className="simpro-editor-tool" title="Bold" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("bold")}>
          <Bold size={15} />
        </button>
        <button type="button" className="simpro-editor-tool" title="Italic" aria-label="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("italic")}>
          <Italic size={15} />
        </button>
        <button type="button" className="simpro-editor-tool" title="Underline" aria-label="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("underline")}>
          <Underline size={15} />
        </button>
        <label className="simpro-editor-tool-select">
          <span className="sr-only">Font size</span>
          <select
            aria-label="Font size"
            value={fontSize}
            onChange={(event) => {
              const next = event.target.value;
              setFontSize(next);
              runCommand("fontSize", next);
            }}
          >
            <option value="2">10pt</option>
            <option value="3">12pt</option>
            <option value="4">14pt</option>
            <option value="5">18pt</option>
          </select>
        </label>
        <button type="button" className="simpro-editor-tool" title="Bullet list" aria-label="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("insertUnorderedList")}>
          <List size={15} />
        </button>
        <button type="button" className="simpro-editor-tool" title="Numbered list" aria-label="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("insertOrderedList")}>
          <ListOrdered size={15} />
        </button>
        <button type="button" className="simpro-editor-tool" title="Remove formatting" aria-label="Remove formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand("removeFormat")}>
          Tx
        </button>
      </div>
      <div
        ref={editorRef}
        className="simpro-editor-surface"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder="Type description…"
        style={{ minHeight }}
        suppressContentEditableWarning
        onInput={emitFromEditor}
        onBlur={emitFromEditor}
      />
    </div>
  );
}
