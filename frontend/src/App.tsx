import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
// @ts-ignore: CSS module declaration not available in this project setup
import './styles.css';
import { documentsApi } from './api/documents';
import { modelsApi } from './api/models';
import { DocumentGrid } from './pages/DocumentGrid';
import { EditorPage } from './pages/EditorPage';
import type { DocumentItem, ModelProfile } from './types';

const STORAGE_KEY = 'ai-text-editor.documents';
const ACTIVE_KEY = 'ai-text-editor.activeDocumentId';
const FOLDERS_KEY = 'ai-text-editor.folders';
const THEME_KEY = 'ai-text-editor.theme';
const SNAPSHOT_PREFIX = 'ai-text-editor.snapshots.';
const ROOT_FOLDER = 'mnt';
const UPLOAD_FOLDER = 'mnt/uploads';

const seedDocuments: DocumentItem[] = [
  {
    id: 'sample-brief',
    name: 'field notes - ai editor brief',
    kind: 'document',
    extension: '.md',
    updatedAt: new Date().toISOString(),
    folder: 'writing samples',
    content:
      '# AI Editor Brief\nThe editor should feel like a quiet writing room with reference-aware assistance nearby.\n## Goals\nKeep document editing fast and predictable. Let reference files support answers without taking over the page. Preserve formatting when AI edits are accepted.\n## Demo Flow\nOpen a markdown file, select a paragraph, improve it, then ask the reference chat about uploaded material.',
  },
  {
    id: 'sample-rag-plan',
    name: 'rag workflow checklist',
    kind: 'document',
    extension: '.md',
    updatedAt: new Date().toISOString(),
    folder: 'writing samples',
    content:
      '# RAG Workflow Checklist\n## Upload\nPDF, markdown, and text files should land in `mnt/uploads` and become reference material.\n## Retrieve\nThe chat should pull only relevant excerpts and group citations by document name.\n## Answer\nThe model should answer directly, avoid repeating chunks, and keep citations visible for review.',
  },
  {
    id: 'sample-observations',
    name: 'plain text import notes',
    kind: 'document',
    extension: '.txt',
    updatedAt: new Date().toISOString(),
    folder: 'reference notes',
    content:
      'Plain text files are useful for lightweight notes and imported source material. They should remain editable, but rich formatting should not be expected to persist in .txt exports.',
  },
];

const seedDocumentMap = new Map(seedDocuments.map((doc) => [doc.id, doc]));

const fallbackModels: ModelProfile[] = [
  { profileName: 'Qwen2.5-3B', modelId: 'qwen2.5-3b-instruct-q4_k_m', maxContextTokens: 8192 },
];

type CreatableExtension = '.md' | '.txt';
type Theme = 'light' | 'dark';
type PendingConfirmation =
  | { type: 'file'; id: string; label: string }
  | { type: 'folder'; path: string; label: string }
  | null;

const invalidFilenamePattern = /[<>:"/\\|?*\u0000-\u001F]/;
const reservedFilenames = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

function withPersistentSamples(documents: DocumentItem[]): DocumentItem[] {
  const normalized = documents.map((doc) => {
    const seed = seedDocumentMap.get(doc.id);
    if (seed) return { ...seed, updatedAt: doc.updatedAt, folder: normalizeFolderPath(seed.folder) };
    return { ...doc, folder: normalizeFolderPath(doc.folder) };
  });
  const existingIds = new Set(normalized.map((doc) => doc.id));
  const missingSamples = seedDocuments
    .filter((doc) => !existingIds.has(doc.id))
    .map((doc) => ({ ...doc, folder: normalizeFolderPath(doc.folder) }));
  return [...normalized, ...missingSamples];
}

function loadStoredDocuments(): DocumentItem[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return withPersistentSamples([]);

  try {
    const parsed = JSON.parse(stored) as DocumentItem[];
    const source = parsed.length ? parsed : seedDocuments;
    return withPersistentSamples(source);
  } catch {
    return withPersistentSamples([]);
  }
}

function loadStoredFolders(): string[] {
  const stored = localStorage.getItem(FOLDERS_KEY);
  if (!stored) return [ROOT_FOLDER, UPLOAD_FOLDER];

  try {
    return Array.from(new Set([ROOT_FOLDER, UPLOAD_FOLDER, ...(JSON.parse(stored) as string[]).map(normalizeFolderPath)]));
  } catch {
    return [ROOT_FOLDER, UPLOAD_FOLDER];
  }
}

function normalizeFolderPath(folder?: string): string {
  if (!folder || folder === 'drafts') return ROOT_FOLDER;
  if (folder === 'uploads' || folder === 'upload' || folder === 'mnt/upload') return UPLOAD_FOLDER;
  if (folder === ROOT_FOLDER || folder.startsWith(`${ROOT_FOLDER}/`)) return folder;
  return `${ROOT_FOLDER}/${folder}`;
}

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return ROOT_FOLDER;
  return parts.slice(0, -1).join('/');
}

function snapshotStorageKey(documentId: string): string {
  return `${SNAPSHOT_PREFIX}${documentId}`;
}

function migrateSnapshotStorage(fromDocumentId: string, toDocumentId: string) {
  if (fromDocumentId === toDocumentId) return;
  const fromKey = snapshotStorageKey(fromDocumentId);
  const toKey = snapshotStorageKey(toDocumentId);
  const stored = localStorage.getItem(fromKey);
  if (!stored || localStorage.getItem(toKey)) return;
  localStorage.setItem(toKey, stored);
  localStorage.removeItem(fromKey);
}

function removeSnapshotStorage(documentId: string) {
  localStorage.removeItem(snapshotStorageKey(documentId));
}

function validateFilename(
  name: string,
  extension: CreatableExtension,
  existingDocuments: DocumentItem[],
  targetFolder?: string,
  ignoreId?: string,
): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a file name.';
  if (trimmed.length > 120) return 'Keep the file name under 120 characters.';
  if (invalidFilenamePattern.test(trimmed)) return 'File names cannot include < > : " / \\ | ? *';
  if (trimmed.endsWith('.') || trimmed.endsWith(' ')) return 'File names cannot end with a period or space.';
  if (reservedFilenames.has(trimmed.toLowerCase())) return 'That name is reserved by Windows.';

  const targetFilename = `${trimmed}${extension}`.toLowerCase();
  const alreadyExists = existingDocuments.some(
    (doc) =>
      doc.id !== ignoreId &&
      `${doc.name.trim()}${doc.extension}`.toLowerCase() === targetFilename &&
      (!targetFolder || normalizeFolderPath(doc.folder) === targetFolder),
  );
  if (alreadyExists) return `A local document named ${trimmed}${extension} already exists.`;

  return '';
}

function validateFolderName(name: string, existingFolders: string[], parent: string, currentPath?: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a folder name.';
  if (trimmed.length > 80) return 'Keep the folder name under 80 characters.';
  if (invalidFilenamePattern.test(trimmed)) return 'Folder names cannot include < > : " / \\ | ? *';
  if (trimmed.endsWith('.') || trimmed.endsWith(' ')) return 'Folder names cannot end with a period or space.';
  if (reservedFilenames.has(trimmed.toLowerCase())) return 'That name is reserved by Windows.';
  const nextPath = `${parent}/${trimmed}`.toLowerCase();
  const exists = existingFolders.some((folder) => folder !== currentPath && folder.toLowerCase() === nextPath);
  if (exists) return `A folder named ${trimmed} already exists here.`;
  return '';
}

function NewDocumentModal({
  open,
  name,
  extension,
  error,
  showUploadOption,
  onNameChange,
  onExtensionChange,
  onCancel,
  onSubmit,
  onUploadFileInstead,
}: {
  open: boolean;
  name: string;
  extension: CreatableExtension;
  error: string;
  showUploadOption: boolean;
  onNameChange: (value: string) => void;
  onExtensionChange: (value: CreatableExtension) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUploadFileInstead?: (file: File) => void;
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="new-document-modal" onSubmit={onSubmit} aria-label="Create new document">
        <h2>New document</h2>
        <div className="filename-row">
          <input
            autoFocus
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="File name"
            aria-invalid={Boolean(error)}
          />
          <select
            value={extension}
            onChange={(event) => onExtensionChange(event.target.value as CreatableExtension)}
            aria-label="File extension"
          >
            <option value=".md">.md</option>
            <option value=".txt">.txt</option>
          </select>
        </div>
        <p className={`filename-error ${error ? 'visible' : ''}`}>{error || 'Use letters, numbers, spaces, dashes, and underscores.'}</p>
        <div className="modal-actions">
          {showUploadOption && (
            <>
              <button type="button" className="modal-upload-button" onClick={() => uploadInputRef.current?.click()}>
                <span className="upload-arrow-icon" aria-hidden="true" />
                Upload file instead
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                hidden
                accept=".pdf,.md,.txt"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file && onUploadFileInstead) onUploadFileInstead(file);
                  event.currentTarget.value = '';
                }}
              />
            </>
          )}
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="modal-create-button">Create</button>
        </div>
      </form>
    </div>
  );
}

function ConfirmationModal({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pending) return null;

  const isFolder = pending.type === 'folder';
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="new-document-modal confirm-modal" aria-label="Confirm deletion">
        <h2>Delete {isFolder ? 'folder' : 'file'}?</h2>
        <p>
          {isFolder
            ? `Deleting ${pending.label} will also remove files and subfolders inside it. This cannot be undone.`
            : `Delete ${pending.label}? This cannot be undone.`}
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="danger-button" onClick={onConfirm}>Delete</button>
        </div>
      </section>
    </div>
  );
}

function makeDocumentFromFile(file: File, content: string): DocumentItem {
  const extension = file.name.toLowerCase().endsWith('.pdf')
    ? '.pdf'
    : file.name.toLowerCase().endsWith('.md')
      ? '.md'
      : '.txt';

  return {
    id: `local-${crypto.randomUUID()}`,
    name: file.name.replace(/\.(pdf|md|txt)$/i, ''),
    kind: extension === '.pdf' ? 'asset' : 'document',
    extension,
    updatedAt: new Date().toISOString(),
    folder: 'uploads',
    content:
      extension === '.pdf'
        ? `# ${file.name}\n\nPDF uploaded and attached for retrieval. Text extraction will appear here when the backend returns parsed content.`
        : content,
  };
}

export default function App() {
  const [documents, setDocuments] = useState<DocumentItem[]>(loadStoredDocuments);
  const [folders, setFolders] = useState<string[]>(loadStoredFolders);
  const [models, setModels] = useState<ModelProfile[]>(fallbackModels);
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_KEY) ?? 'sample-brief');
  const [selectedModelId, setSelectedModelId] = useState(fallbackModels[0].modelId);
  const [showHome, setShowHome] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState(ROOT_FOLDER);
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) || 'light');
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newDocumentName, setNewDocumentName] = useState('');
  const [newDocumentExtension, setNewDocumentExtension] = useState<CreatableExtension>('.md');
  const [filenameError, setFilenameError] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documents));
  }, [documents]);

  useEffect(() => {
    const documentFolders = Array.from(new Set(documents.map((doc) => normalizeFolderPath(doc.folder))));
    setFolders((prev) => Array.from(new Set([ROOT_FOLDER, UPLOAD_FOLDER, ...prev.map(normalizeFolderPath), ...documentFolders])));
  }, [documents]);

  useEffect(() => {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);

  useEffect(() => {
    documentsApi
      .list()
      .then((remoteDocs) => {
        if (remoteDocs.length) setDocuments(withPersistentSamples(remoteDocs));
      })
      .catch(() => undefined);

    modelsApi
      .list()
      .then((response) => {
        if (!response.length) return;
        setModels(response);
        setSelectedModelId(response[0].modelId);
      })
      .catch(() => undefined);
  }, []);

  const active = useMemo(
    () => documents.find((doc) => doc.id === activeId) ?? documents[0] ?? null,
    [activeId, documents],
  );

  function updateDocument(id: string, patch: Partial<DocumentItem>) {
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === id ? { ...doc, ...patch, updatedAt: new Date().toISOString() } : doc,
      ),
    );
    if (!id.startsWith('local-') && !id.startsWith('sample-')) {
      documentsApi.update(id, patch).catch(() => undefined);
    }
  }

  async function handleUpload(file: File) {
    const content = file.name.toLowerCase().endsWith('.pdf') ? '' : await file.text();
    const targetFolder = UPLOAD_FOLDER;
    const localDoc = { ...makeDocumentFromFile(file, content), folder: targetFolder };
    setFolders((prev) => Array.from(new Set([...prev, targetFolder])));
    setCollapsedFolders((prev) => prev.filter((folder) => !targetFolder.startsWith(`${folder}/`) && folder !== targetFolder));
    setDocuments((prev) => [localDoc, ...prev]);
    setActiveId(localDoc.id);
    setShowHome(false);

    documentsApi
      .uploadAsset(file)
      .then((uploaded) => {
        migrateSnapshotStorage(localDoc.id, uploaded.id);
        setDocuments((prev) =>
          prev.map((doc) =>
            doc.id === localDoc.id
              ? { ...doc, ...uploaded, content: uploaded.content ?? doc.content, folder: doc.folder }
              : doc,
          ),
        );
        setActiveId(uploaded.id);
      })
      .catch(() => undefined);
  }

  function openCreateDocumentModal() {
    setNewDocumentName('');
    setNewDocumentExtension('.md');
    setFilenameError('');
    setCreateModalOpen(true);
  }

  function closeCreateDocumentModal() {
    setCreateModalOpen(false);
    setFilenameError('');
  }

  function createDocument(name: string, extension: CreatableExtension) {
    const doc: DocumentItem = {
      id: `local-${crypto.randomUUID()}`,
      name,
      kind: 'document',
      extension,
      updatedAt: new Date().toISOString(),
      folder: selectedFolder,
      content: 'Start writing here.',
    };
    setFolders((prev) => Array.from(new Set([...prev, selectedFolder])));
    setCollapsedFolders((prev) => prev.filter((folder) => !selectedFolder.startsWith(`${folder}/`) && folder !== selectedFolder));
    setDocuments((prev) => [doc, ...prev]);
    setActiveId(doc.id);
    setShowHome(false);
    closeCreateDocumentModal();
    documentsApi
      .create({ name, extension, content: doc.content ?? '', folder: selectedFolder })
      .then((created) => {
        migrateSnapshotStorage(doc.id, created.id);
        setDocuments((prev) => prev.map((item) => (item.id === doc.id ? { ...doc, ...created, folder: doc.folder } : item)));
        setActiveId(created.id);
      })
      .catch(() => undefined);
  }

  function submitCreateDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateFilename(newDocumentName, newDocumentExtension, documents, selectedFolder);
    setFilenameError(error);
    if (error) return;
    createDocument(newDocumentName.trim(), newDocumentExtension);
  }

  function removeDocument(id: string) {
    const target = documents.find((doc) => doc.id === id);
    const label = target ? `${target.name}${target.extension}` : 'this file';
    setPendingConfirmation({ type: 'file', id, label });
  }

  function confirmRemoveDocument(id: string) {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
    if (activeId === id) setActiveId(documents.find((doc) => doc.id !== id)?.id ?? '');
    removeSnapshotStorage(id);
    if (!id.startsWith('sample-')) documentsApi.remove(id).catch(() => undefined);
  }

  function selectDocument(id: string) {
    const target = documents.find((doc) => doc.id === id);
    if (target?.folder) setSelectedFolder(target.folder);
    setActiveId(id);
  }

  function createFolder() {
    const parent = selectedFolder || ROOT_FOLDER;
    const base = 'new folder';
    let candidate = base;
    let index = 2;
    const existing = new Set(folders.map((folder) => folder.toLowerCase()));
    while (existing.has(`${parent}/${candidate}`.toLowerCase())) {
      candidate = `${base} ${index}`;
      index += 1;
    }
    const path = `${parent}/${candidate}`;
    setFolders((prev) => [...prev, path]);
    setSelectedFolder(path);
    setCollapsedFolders((prev) => prev.filter((folder) => !path.startsWith(`${folder}/`) && folder !== path));
  }

  function selectFolder(folder: string) {
    setSelectedFolder(folder);
    setCollapsedFolders((prev) =>
      prev.includes(folder) ? prev.filter((item) => item !== folder) : [...prev, folder],
    );
  }

  function toggleTheme() {
    setTheme((current) => (current === 'light' ? 'dark' : 'light'));
  }

  function uploadFromCreateModal(file: File) {
    closeCreateDocumentModal();
    void handleUpload(file);
  }

  function renameDocument(id: string, nextName: string): string {
    const target = documents.find((doc) => doc.id === id);
    if (!target || target.extension === '.pdf') return 'This file cannot be renamed here.';
    const error = validateFilename(nextName, target.extension as CreatableExtension, documents, normalizeFolderPath(target.folder), id);
    if (error) return error;
    updateDocument(id, { name: nextName.trim() });
    return '';
  }

  function renameFolder(path: string, nextName: string): string {
    if (path === ROOT_FOLDER || path === UPLOAD_FOLDER) return 'This system folder cannot be renamed.';
    const parent = parentPath(path);
    const error = validateFolderName(nextName, folders, parent, path);
    if (error) return error;
    const nextPath = `${parent}/${nextName.trim()}`;
    setFolders((prev) =>
      prev.map((folder) => (folder === path || folder.startsWith(`${path}/`) ? `${nextPath}${folder.slice(path.length)}` : folder)),
    );
    setDocuments((prev) =>
      prev.map((doc) => {
        const folder = normalizeFolderPath(doc.folder);
        return folder === path || folder.startsWith(`${path}/`)
          ? { ...doc, folder: `${nextPath}${folder.slice(path.length)}` }
          : doc;
      }),
    );
    if (selectedFolder === path || selectedFolder.startsWith(`${path}/`)) {
      setSelectedFolder(`${nextPath}${selectedFolder.slice(path.length)}`);
    }
    return '';
  }

  function requestDeleteFolder(path: string) {
    if (path === ROOT_FOLDER || path === UPLOAD_FOLDER) return;
    setPendingConfirmation({ type: 'folder', path, label: basename(path) });
  }

  function confirmDeleteFolder(path: string) {
    documents
      .filter((doc) => {
        const folder = normalizeFolderPath(doc.folder);
        return folder === path || folder.startsWith(`${path}/`);
      })
      .forEach((doc) => removeSnapshotStorage(doc.id));
    setFolders((prev) => prev.filter((folder) => folder !== path && !folder.startsWith(`${path}/`)));
    setDocuments((prev) => prev.filter((doc) => {
      const folder = normalizeFolderPath(doc.folder);
      return folder !== path && !folder.startsWith(`${path}/`);
    }));
    if (selectedFolder === path || selectedFolder.startsWith(`${path}/`)) setSelectedFolder(ROOT_FOLDER);
  }

  function confirmPendingDeletion() {
    if (!pendingConfirmation) return;
    if (pendingConfirmation.type === 'file') confirmRemoveDocument(pendingConfirmation.id);
    if (pendingConfirmation.type === 'folder') confirmDeleteFolder(pendingConfirmation.path);
    setPendingConfirmation(null);
  }

  if (showHome) {
    return (
      <>
        <DocumentGrid
          items={documents}
          onOpen={(doc) => {
            selectDocument(doc.id);
            setShowHome(false);
          }}
          onCreate={openCreateDocumentModal}
          onUpload={handleUpload}
        />
        <NewDocumentModal
          open={createModalOpen}
          name={newDocumentName}
          extension={newDocumentExtension}
          error={filenameError}
          showUploadOption={false}
          onNameChange={(value) => {
            setNewDocumentName(value);
            if (filenameError) setFilenameError(validateFilename(value, newDocumentExtension, documents, selectedFolder));
          }}
          onExtensionChange={(value) => {
            setNewDocumentExtension(value);
            if (filenameError) setFilenameError(validateFilename(newDocumentName, value, documents, selectedFolder));
          }}
          onCancel={closeCreateDocumentModal}
          onSubmit={submitCreateDocument}
        />
        <ConfirmationModal
          pending={pendingConfirmation}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={confirmPendingDeletion}
        />
      </>
    );
  }

  return (
    <>
      <EditorPage
        document={active}
        documents={documents}
        models={models}
        selectedModelId={selectedModelId}
        folders={folders}
        selectedFolder={selectedFolder}
        collapsedFolders={collapsedFolders}
        theme={theme}
        onModelChange={setSelectedModelId}
        onSelectDocument={selectDocument}
        onSelectFolder={selectFolder}
        onCreateFolder={createFolder}
        onRenameDocument={renameDocument}
        onRenameFolder={renameFolder}
        onDeleteFolder={requestDeleteFolder}
        onUpdateDocument={updateDocument}
        onCreateDocument={openCreateDocumentModal}
        onToggleTheme={toggleTheme}
        onUpload={handleUpload}
        onRemoveDocument={removeDocument}
        onShowHome={() => setShowHome(true)}
      />
      <NewDocumentModal
        open={createModalOpen}
        name={newDocumentName}
        extension={newDocumentExtension}
        error={filenameError}
        showUploadOption
        onNameChange={(value) => {
          setNewDocumentName(value);
          if (filenameError) setFilenameError(validateFilename(value, newDocumentExtension, documents, selectedFolder));
        }}
        onExtensionChange={(value) => {
          setNewDocumentExtension(value);
          if (filenameError) setFilenameError(validateFilename(newDocumentName, value, documents, selectedFolder));
        }}
        onCancel={closeCreateDocumentModal}
        onSubmit={submitCreateDocument}
        onUploadFileInstead={uploadFromCreateModal}
      />
      <ConfirmationModal
        pending={pendingConfirmation}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={confirmPendingDeletion}
      />
    </>
  );
}
