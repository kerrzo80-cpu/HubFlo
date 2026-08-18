"use client";

import { useMemo, useState } from "react";
import { ChevronDown, FolderPlus } from "lucide-react";

import type { TakeoffDocument } from "@/lib/takeoff-data";
import {
  groupTakeoffDrawings,
  inferDrawingFolderMeta,
  UNGROUPED_HOUSE_TYPE,
  type DrawingHouseTypeFolder,
} from "@/lib/takeoff-drawing-folders";
import { takeoffDrawingDisplayLabel } from "@/lib/takeoff-drawing-labels";

type TakeoffDrawingFoldersProps = {
  documents: TakeoffDocument[];
  activeDocumentId?: string | null;
  extraHouseTypes?: string[];
  openKeys: Record<string, boolean>;
  onToggle: (key: string) => void;
  onOpenDocument: (documentId: string) => void;
  onAssignHouseType: (documentId: string, houseType: string) => void;
  onCreateFolder: (name: string) => void;
};

export function TakeoffDrawingFolders({
  documents,
  activeDocumentId,
  extraHouseTypes = [],
  openKeys,
  onToggle,
  onOpenDocument,
  onAssignHouseType,
  onCreateFolder,
}: TakeoffDrawingFoldersProps) {
  const [draftFolder, setDraftFolder] = useState("");
  const folders = useMemo(
    () => groupTakeoffDrawings(documents, extraHouseTypes),
    [documents, extraHouseTypes],
  );
  const allFileNames = useMemo(() => documents.map((doc) => doc.fileName), [documents]);
  const folderNames = folders.map((folder) => folder.label);

  function addFolder() {
    const name = draftFolder.trim();
    if (!name) return;
    onCreateFolder(name);
    setDraftFolder("");
  }

  if (!documents.length) {
    return <p className="muted">Upload a PDF or sync from the linked tender.</p>;
  }

  return (
    <>
      <div className="nexa-studio-create class nexa-studio-doc-folder-create">
        <input
          value={draftFolder}
          onChange={(event) => setDraftFolder(event.target.value)}
          placeholder="New folder"
          aria-label="New house-type folder"
          onKeyDown={(event) => {
            if (event.key === "Enter") addFolder();
          }}
        />
        <button type="button" className="ghost" onClick={addFolder}>
          <FolderPlus size={14} />
          Add
        </button>
      </div>
      {folders.map((folder) => (
        <HouseTypeFolder
          key={folder.key}
          folder={folder}
          activeDocumentId={activeDocumentId}
          allFileNames={allFileNames}
          folderNames={folderNames}
          openKeys={openKeys}
          onToggle={onToggle}
          onOpenDocument={onOpenDocument}
          onAssignHouseType={onAssignHouseType}
        />
      ))}
    </>
  );
}

function HouseTypeFolder({
  folder,
  activeDocumentId,
  allFileNames,
  folderNames,
  openKeys,
  onToggle,
  onOpenDocument,
  onAssignHouseType,
}: {
  folder: DrawingHouseTypeFolder;
  activeDocumentId?: string | null;
  allFileNames: string[];
  folderNames: string[];
  openKeys: Record<string, boolean>;
  onToggle: (key: string) => void;
  onOpenDocument: (documentId: string) => void;
  onAssignHouseType: (documentId: string, houseType: string) => void;
}) {
  const open = Boolean(openKeys[folder.key]);
  const hasActive = folder.documents.some((doc) => doc.id === activeDocumentId);
  const nestDisciplines = folder.disciplines.filter((row) => row.key).length > 0;
  const ungrouped = folder.label === UNGROUPED_HOUSE_TYPE;

  return (
    <div
      className={`nexa-studio-doc-folder${open ? " is-open" : ""}${hasActive ? " has-active" : ""}`}
    >
      <button
        type="button"
        className="nexa-studio-doc-folder-toggle"
        aria-expanded={open}
        onClick={() => onToggle(folder.key)}
      >
        <ChevronDown size={14} aria-hidden />
        <span className="nexa-studio-doc-folder-label">
          {folder.label}
          {ungrouped ? <em> assign type</em> : null}
        </span>
        <strong>{folder.documents.length}</strong>
      </button>
      {open ? (
        <div className="nexa-studio-doc-folder-body">
          {nestDisciplines
            ? folder.disciplines.map((group) => {
                const discKey = `${folder.key}::${group.key}`;
                const discOpen = openKeys[discKey] !== false;
                const discHasActive = group.documents.some((doc) => doc.id === activeDocumentId);
                return (
                  <div
                    key={discKey}
                    className={`nexa-studio-doc-folder nexa-studio-doc-folder-nested${discOpen ? " is-open" : ""}${discHasActive ? " has-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="nexa-studio-doc-folder-toggle"
                      aria-expanded={discOpen}
                      onClick={() => onToggle(discKey)}
                    >
                      <ChevronDown size={13} aria-hidden />
                      <span className="nexa-studio-doc-folder-label">{group.label}</span>
                      <strong>{group.documents.length}</strong>
                    </button>
                    {discOpen
                      ? group.documents.map((doc) => (
                          <DrawingFileButton
                            key={doc.id}
                            doc={doc as TakeoffDocument}
                            active={doc.id === activeDocumentId}
                            allFileNames={allFileNames}
                            folderNames={folderNames}
                            currentFolder={folder.label}
                            onOpenDocument={onOpenDocument}
                            onAssignHouseType={onAssignHouseType}
                          />
                        ))
                      : null}
                  </div>
                );
              })
            : folder.documents.map((doc) => (
                <DrawingFileButton
                  key={doc.id}
                  doc={doc as TakeoffDocument}
                  active={doc.id === activeDocumentId}
                  allFileNames={allFileNames}
                  folderNames={folderNames}
                  currentFolder={folder.label}
                  onOpenDocument={onOpenDocument}
                  onAssignHouseType={onAssignHouseType}
                />
              ))}
        </div>
      ) : null}
    </div>
  );
}

function DrawingFileButton({
  doc,
  active,
  allFileNames,
  folderNames,
  currentFolder,
  onOpenDocument,
  onAssignHouseType,
}: {
  doc: TakeoffDocument;
  active: boolean;
  allFileNames: string[];
  folderNames: string[];
  currentFolder: string;
  onOpenDocument: (documentId: string) => void;
  onAssignHouseType: (documentId: string, houseType: string) => void;
}) {
  const meta = inferDrawingFolderMeta(doc, allFileNames);
  return (
    <div className={`nexa-studio-doc-file-row${active ? " on" : ""}`}>
      <button
        type="button"
        className={`nexa-studio-doc-file${active ? " on" : ""}`}
        title={takeoffDrawingDisplayLabel(doc.fileName, doc.notes)}
        onClick={() => onOpenDocument(doc.id)}
      >
        {meta.discipline && currentFolder !== meta.discipline ? (
          <strong className="nexa-studio-doc-set">{meta.discipline}</strong>
        ) : null}
        <span className="nexa-studio-doc-name">{doc.fileName}</span>
      </button>
      <label className="nexa-studio-doc-move">
        <span className="sr-only">Move {doc.fileName} to folder</span>
        <select
          value={currentFolder}
          aria-label={`Folder for ${doc.fileName}`}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onAssignHouseType(doc.id, event.target.value)}
        >
          {folderNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
