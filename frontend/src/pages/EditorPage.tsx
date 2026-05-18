import { useEffect, useMemo, useRef, useState } from 'react';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { chatApi, type ChatAction } from '../api/chat';
import { retrievalApi } from '../api/retrieval';
import type { ChatCitation, DocumentItem, ModelProfile } from '../types';
import { FilesTab } from '../components/FilesTab';
import { HeaderHighlighter, type HeaderHighlight } from '../components/HeaderHighlighter';
import { ModelSelector } from '../components/ModelSelector';
import { TokenUsageIndicator } from '../components/TokenUsageIndicator';

interface Props {
  document: DocumentItem | null;
  documents: DocumentItem[];
  models: ModelProfile[];
  selectedModelId: string;
  folders: string[];
  selectedFolder: string;
  collapsedFolders: string[];
  theme: 'light' | 'dark';
  onModelChange: (value: string) => void;
  onSelectDocument: (id: string) => void;
  onSelectFolder: (folder: string) => void;
  onCreateFolder: () => void;
  onRenameDocument: (id: string, name: string) => string;
  onRenameFolder: (path: string, name: string) => string;
  onDeleteFolder: (path: string) => void;
  onUpdateDocument: (id: string, patch: Partial<DocumentItem>) => void;
  onCreateDocument: () => void;
  onToggleTheme: () => void;
  onUpload: (file: File) => void;
  onRemoveDocument: (id: string) => void;
  onShowHome: () => void;
}

interface Snapshot {
  id: string;
  label: string;
  timestamp: string;
  content: string;
}

interface AiReview {
  action: ChatAction;
  originalContent: string;
  originalFrom: number;
  originalTo: number;
  from: number;
  to: number;
}

interface BubblePosition {
  top: number;
  left: number;
}

interface RagChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function ragChatStorageKey(documentId: string): string {
  return `ai-text-editor.ragChat.${documentId}`;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readingTime(words: number): number {
  return Math.max(1, Math.ceil(words / 225));
}

function normalizeHtml(text: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return text
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h1>${escape(line.slice(2))}</h1>`;
      if (line.startsWith('## ')) return `<h2>${escape(line.slice(3))}</h2>`;
      if (line.startsWith('### ')) return `<h3>${escape(line.slice(4))}</h3>`;
      if (!line.trim()) return '<p><br /></p>';
      return `<p>${escape(line)}</p>`;
    })
    .join('');
}

function isHtmlContent(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content.trim());
}

function toEditorHtml(content: string): string {
  return isHtmlContent(content) ? content : normalizeHtml(content);
}

function htmlToPlainText(content: string): string {
  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToMarkdown(content: string): string {
  if (!isHtmlContent(content)) return content;
  return content
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '> $1\n\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function groupDocuments(documents: DocumentItem[], folders: string[]) {
  const initialGroups = folders.reduce<Record<string, DocumentItem[]>>((groups, folder) => {
    groups[folder] = [];
    return groups;
  }, {});

  return documents.reduce<Record<string, DocumentItem[]>>((groups, doc) => {
    const key = doc.folder ?? (doc.kind === 'asset' ? 'uploads' : 'drafts');
    groups[key] = [...(groups[key] ?? []), doc];
    return groups;
  }, initialGroups);
}

function folderDepth(path: string): number {
  return Math.max(0, path.split('/').filter(Boolean).length - 1);
}

function folderName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function collectHeaders(json: any): HeaderHighlight[] {
  const headers: HeaderHighlight[] = [];
  const colors = ['#e6f4ff', '#fff1a8', '#ffe0ef', '#dff8e7', '#e9e1ff'];

  function visit(node: any) {
    if (node.type === 'heading') {
      const text = node.content?.map((child: any) => child.text ?? '').join('') ?? '';
      if (text) {
        const level = node.attrs?.level ?? 1;
        headers.push({ level, text, color: colors[headers.length % colors.length] });
      }
    }
    node.content?.forEach(visit);
  }

  visit(json);
  return headers;
}

function collectEditorHeaders(activeEditor: any): HeaderHighlight[] {
  const headers: HeaderHighlight[] = [];
  const colors = ['#e6f4ff', '#fff1a8', '#ffe0ef', '#dff8e7', '#e9e1ff'];
  activeEditor.state.doc.descendants((node: any, position: number) => {
    if (node.type.name !== 'heading') return;
    const text = node.textContent;
    if (!text) return;
    headers.push({
      level: node.attrs.level ?? 1,
      text,
      color: colors[headers.length % colors.length],
      position,
    });
  });
  return headers;
}

function cleanAiActionText(action: ChatAction, text: string): string {
  let cleaned = text
    .replace(/\n*\(Ollama fallback used:[\s\S]*?\)\s*$/i, '')
    .trim();

  if (cleaned.includes('Selected text:')) {
    cleaned = cleaned.split('Selected text:', 2)[1]?.trim() ?? cleaned;
  }

  [
    /\bTo improve the selected editor text\b.*?(?:\.\s*|$)/gis,
    /\bImprove the selected editor text\b.*?(?:\.\s*|$)/gis,
    /\bSummarize the selected editor text\b.*?(?:\.\s*|$)/gis,
    /\bUse only facts and ideas present\b.*?(?:\.\s*|$)/gis,
    /\bReturn only (?:the )?(?:revised|summary) text\b.*?(?:\.\s*|$)/gis,
    /\bDo not add new (?:details|information)\b.*?(?:\.\s*|$)/gis,
    /\bKeep it concise and natural\b.*?(?:\.\s*|$)/gis,
  ].forEach((pattern) => {
    cleaned = cleaned.replace(pattern, '').trim();
  });

  cleaned = action === 'summarize'
    ? cleaned.replace(/^\s*(summary|summarized version|brief summary)\s*:\s*/i, '')
    : cleaned.replace(/^\s*(improved version|revised text|revision)\s*:\s*/i, '');

  const paragraphs = cleaned.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const seen = new Set<string>();
  return paragraphs
    .filter((paragraph) => {
      const key = paragraph.replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n\n')
    .trim();
}

export function EditorPage({
  document,
  documents,
  models,
  selectedModelId,
  folders,
  selectedFolder,
  collapsedFolders,
  theme,
  onModelChange,
  onSelectDocument,
  onSelectFolder,
  onCreateFolder,
  onRenameDocument,
  onRenameFolder,
  onDeleteFolder,
  onUpdateDocument,
  onCreateDocument,
  onToggleTheme,
  onUpload,
  onRemoveDocument,
  onShowHome,
}: Props) {
  const loadedDocumentIdRef = useRef<string | null>(null);
  const snapshotsHydratedRef = useRef(false);
  const treeUploadInputRef = useRef<HTMLInputElement | null>(null);
  const ragMessagesRef = useRef<HTMLDivElement | null>(null);
  const ragShouldStickToBottomRef = useRef(true);
  const [content, setContent] = useState(document?.content ?? '');
  const [plainText, setPlainText] = useState(document?.content ?? '');
  const [citations, setCitations] = useState<ChatCitation[]>([]);
  const [ragQuery, setRagQuery] = useState('');
  const [ragStatus, setRagStatus] = useState<'idle' | 'asking' | 'error'>('idle');
  const [ragMessages, setRagMessages] = useState<RagChatMessage[]>([]);
  const [ragHistoryDocumentId, setRagHistoryDocumentId] = useState<string | null>(document?.id ?? null);
  const [ragHistoryReady, setRagHistoryReady] = useState(false);
  const [aiActionStatus, setAiActionStatus] = useState<ChatAction | null>(null);
  const [aiReview, setAiReview] = useState<AiReview | null>(null);
  const [reviewBubblePosition, setReviewBubblePosition] = useState<BubblePosition | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectionText, setSelectionText] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const [status, setStatus] = useState(`Saved locally at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  const [rightTab, setRightTab] = useState<'ai' | 'files'>('ai');
  const [headers, setHeaders] = useState<HeaderHighlight[]>([]);
  const [toolbarVersion, setToolbarVersion] = useState(0);
  const [txtWarningVisible, setTxtWarningVisible] = useState(false);
  const [suppressTxtWarning, setSuppressTxtWarning] = useState(
    () => localStorage.getItem('ai-text-editor.suppressTxtWarning') === 'true',
  );
  const [contextMenu, setContextMenu] = useState<
    | { type: 'file'; id: string; x: number; y: number }
    | { type: 'folder'; path: string; x: number; y: number }
    | null
  >(null);
  const [renaming, setRenaming] = useState<{ type: 'file' | 'folder'; id: string; value: string; error: string } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
    ],
    content: toEditorHtml(document?.content ?? ''),
    editorProps: {
      attributes: {
        class: 'rich-editor',
        spellcheck: 'true',
      },
      handleKeyDown: (view, event) => {
        if (event.key !== 'Backspace') return false;
        const { selection } = view.state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.parentOffset !== 0 || $from.parent.type.name !== 'paragraph') return false;

        const containerDepth = $from.depth - 1;
        if (containerDepth < 0) return false;
        const container = $from.node(containerDepth);
        const index = $from.index(containerDepth);
        const previous = index > 0 ? container.child(index - 1) : null;
        return previous?.type.name === 'heading';
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      setContent(document?.extension === '.txt' ? activeEditor.getText({ blockSeparator: '\n' }) : activeEditor.getHTML());
      setPlainText(activeEditor.getText({ blockSeparator: ' ' }));
      setHeaders(collectEditorHeaders(activeEditor));
      setToolbarVersion((version) => version + 1);
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      const { from, to } = activeEditor.state.selection;
      setSelectionText(activeEditor.state.doc.textBetween(from, to, ' ').trim());
      setToolbarVersion((version) => version + 1);
    },
    onTransaction: () => setToolbarVersion((version) => version + 1),
    onFocus: () => setToolbarVersion((version) => version + 1),
    onBlur: () => setToolbarVersion((version) => version + 1),
  });

  useEffect(() => {
    if (!editor || !document || loadedDocumentIdRef.current === document.id) return;
    loadedDocumentIdRef.current = document.id;

    const nextContent = document.content ?? '';
    setContent(nextContent);
    setPlainText(isHtmlContent(nextContent) ? editor.getText({ blockSeparator: ' ' }) : nextContent);
    const html = toEditorHtml(nextContent);
    editor.commands.setContent(html, { emitUpdate: false });
    setPlainText(editor.getText({ blockSeparator: ' ' }));
    setHeaders(collectEditorHeaders(editor));
  }, [document?.id, editor]);

  useEffect(() => {
    if (!document) return;
    setStatus('Saving...');
    const timer = window.setTimeout(() => {
      onUpdateDocument(document.id, { content });
      setStatus(`Saved locally at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [content, document?.id]);

  useEffect(() => {
    snapshotsHydratedRef.current = false;
    if (!document) {
      setSnapshots([]);
      return;
    }

    const stored = localStorage.getItem(`ai-text-editor.snapshots.${document.id}`);
    try {
      setSnapshots(stored ? (JSON.parse(stored) as Snapshot[]) : []);
    } catch {
      setSnapshots([]);
    }
  }, [document?.id]);

  useEffect(() => {
    if (!document) return;
    if (!snapshotsHydratedRef.current) {
      snapshotsHydratedRef.current = true;
      return;
    }
    localStorage.setItem(`ai-text-editor.snapshots.${document.id}`, JSON.stringify(snapshots));
  }, [snapshots, document?.id]);

  useEffect(() => {
    if (document?.extension === '.txt' && !suppressTxtWarning) {
      setTxtWarningVisible(true);
    }
    setAiReview(null);
    setReviewBubblePosition(null);
    setAiActionStatus(null);
  }, [document?.id, document?.extension, suppressTxtWarning]);

  useEffect(() => {
    setRagHistoryReady(false);
    if (!document) {
      setRagMessages([]);
      setRagHistoryDocumentId(null);
      return;
    }

    const stored = localStorage.getItem(ragChatStorageKey(document.id));
    try {
      setRagMessages(stored ? (JSON.parse(stored) as RagChatMessage[]) : []);
    } catch {
      setRagMessages([]);
    }
    setRagHistoryDocumentId(document.id);
    setRagHistoryReady(true);
    ragShouldStickToBottomRef.current = true;
  }, [document?.id]);

  useEffect(() => {
    if (!document) return;
    if (!ragHistoryReady) return;
    if (ragHistoryDocumentId !== document.id) return;
    localStorage.setItem(ragChatStorageKey(document.id), JSON.stringify(ragMessages));
  }, [document?.id, ragHistoryDocumentId, ragHistoryReady, ragMessages]);

  useEffect(() => {
    if (!editor || !aiReview) return;

    function updateBubblePosition() {
      if (!editor || !aiReview) return;
      const coords = editor.view.coordsAtPos(aiReview.to);
      setReviewBubblePosition({
        top: coords.bottom + 10,
        left: Math.min(Math.max(coords.left, 16), window.innerWidth - 190),
      });
    }

    updateBubblePosition();
    window.addEventListener('resize', updateBubblePosition);
    window.addEventListener('scroll', updateBubblePosition, true);
    return () => {
      window.removeEventListener('resize', updateBubblePosition);
      window.removeEventListener('scroll', updateBubblePosition, true);
    };
  }, [editor, aiReview]);

  const groupedDocuments = useMemo(() => groupDocuments(documents, folders), [documents, folders]);
  const words = useMemo(() => wordCount(plainText), [plainText]);
  const queryTokens = useMemo(() => estimateTokens(ragQuery), [ragQuery]);
  const snippetTokens = useMemo(
    () => citations.reduce((sum, c) => sum + estimateTokens(c.snippet), 0),
    [citations],
  );
  const selected = models.find((model) => model.modelId === selectedModelId);
  const isPlainTextDocument = document?.extension === '.txt';
  const isPdfDocument = document?.extension === '.pdf';
  const files = useMemo(
    () => documents.filter((doc) => ['.pdf', '.md', '.txt'].includes(doc.extension)),
    [documents],
  );
  const groupedCitations = useMemo(() => {
    return citations.reduce<Record<string, ChatCitation[]>>((groups, citation) => {
      const key = citation.file || citation.title;
      groups[key] = [...(groups[key] ?? []), citation];
      return groups;
    }, {});
  }, [citations]);

  useEffect(() => {
    const messageBox = ragMessagesRef.current;
    if (!messageBox || !ragShouldStickToBottomRef.current) return;
    messageBox.scrollTo({
      top: messageBox.scrollHeight,
      behavior: ragStatus === 'asking' ? 'smooth' : 'auto',
    });
  }, [ragMessages, ragStatus]);

  function focusEditor() {
    return editor?.chain().focus();
  }

  const activeHeading = editor?.isActive('heading', { level: 1 })
    ? 'h1'
    : editor?.isActive('heading', { level: 2 })
      ? 'h2'
      : editor?.isActive('heading', { level: 3 })
        ? 'h3'
        : 'p';

  const isAlignActive = (alignment: 'left' | 'center' | 'right') =>
    alignment === 'left'
      ? Boolean(editor && !editor.isActive({ textAlign: 'center' }) && !editor.isActive({ textAlign: 'right' }))
      : Boolean(editor?.isActive({ textAlign: alignment }));

  const toolbarButtonClass = (active?: boolean) => `toolbar-button${active ? ' active' : ''}`;

  function focusEditorFromPaper(event: React.MouseEvent<HTMLElement>) {
    if (!editor) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, button, select, textarea, [contenteditable="true"]')) return;
    editor.chain().focus('end').run();
  }

  function jumpToHeader(position: number) {
    editor?.chain().focus().setTextSelection(position + 1).scrollIntoView().run();
  }

  function startRenameFile(doc: DocumentItem) {
    setRenaming({ type: 'file', id: doc.id, value: doc.name, error: '' });
    setContextMenu(null);
  }

  function startRenameFolder(path: string) {
    setRenaming({ type: 'folder', id: path, value: folderName(path), error: '' });
    setContextMenu(null);
  }

  function commitRename() {
    if (!renaming) return;
    const error = renaming.type === 'file'
      ? onRenameDocument(renaming.id, renaming.value)
      : onRenameFolder(renaming.id, renaming.value);
    if (error) {
      setRenaming({ ...renaming, error });
      return;
    }
    setRenaming(null);
  }

  function saveDocumentAs(doc: DocumentItem) {
    const safeName = doc.name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim() || 'document';
    const source = doc.id === document?.id ? content : doc.content ?? '';
    const output = doc.extension === '.txt' || doc.extension === '.pdf' ? htmlToPlainText(source) : htmlToMarkdown(source);
    downloadTextFile(`${safeName}${doc.extension}`, output);
    setContextMenu(null);
  }

  function isProtectedFolder(path: string): boolean {
    return path === 'mnt' || path === 'mnt/uploads';
  }

  function isFolderHidden(path: string): boolean {
    return collapsedFolders.some((folder) => path !== folder && path.startsWith(`${folder}/`));
  }

  async function runAction(action: ChatAction) {
    if (!document || !editor || aiActionStatus) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim() || selectionText;
    if (!selectedText) {
      setStatus('Select text first');
      return;
    }

    setAiReview(null);
    setReviewBubblePosition(null);
    setStatus(action === 'summarize' ? 'Summarizing...' : 'Improving...');
    setAiActionStatus(action);
    const originalContent = document.extension === '.txt' ? editor.getText({ blockSeparator: '\n' }) : editor.getHTML();
    try {
      const reply = await chatApi.ask({
        documentId: document.id,
        selectedText,
        action,
        modelId: selectedModelId,
      });
      setCitations(reply.citations);
      replaceSelectionWithReview(action, from, to, originalContent, cleanAiActionText(action, reply.text));
      setStatus(action === 'summarize' ? 'Summary ready to review' : 'Improvement ready to review');
    } catch {
      const fallback =
        action === 'summarize'
          ? `${selectedText.split(/\s+/).slice(0, 45).join(' ')}${selectedText.split(/\s+/).length > 45 ? '...' : ''}`
          : selectedText.replace(/\s+/g, ' ').trim();
      replaceSelectionWithReview(action, from, to, originalContent, fallback);
      setStatus('Local fallback ready to review');
    } finally {
      setAiActionStatus(null);
    }
  }

  function replaceSelectionWithReview(
    action: ChatAction,
    from: number,
    to: number,
    originalContent: string,
    replacement: string,
  ) {
    if (!editor) return;
    const nextText = replacement.trim();
    if (!nextText) {
      setStatus('AI returned no text');
      return;
    }

    const nextTo = from + nextText.length;
    editor.chain().focus().insertContentAt({ from, to }, nextText).setTextSelection({ from, to: nextTo }).run();
    setAiReview({ action, originalContent, originalFrom: from, originalTo: to, from, to: nextTo });
    window.requestAnimationFrame(() => {
      const coords = editor.view.coordsAtPos(nextTo);
      setReviewBubblePosition({
        top: coords.bottom + 10,
        left: Math.min(Math.max(coords.left, 16), window.innerWidth - 190),
      });
    });
  }

  function applyAiReview() {
    if (!aiReview || !editor) return;
    editor.chain().focus().setTextSelection({ from: aiReview.from, to: aiReview.to }).run();
    setAiReview(null);
    setReviewBubblePosition(null);
    setStatus(aiReview.action === 'summarize' ? 'Summary applied' : 'Improvement applied');
  }

  function discardAiReview() {
    if (!aiReview || !editor) return;
    editor.commands.setContent(toEditorHtml(aiReview.originalContent), { emitUpdate: true });
    editor.chain().focus().setTextSelection({ from: aiReview.originalFrom, to: aiReview.originalTo }).run();
    setContent(aiReview.originalContent);
    setPlainText(editor.getText({ blockSeparator: ' ' }));
    setHeaders(collectEditorHeaders(editor));
    setAiReview(null);
    setReviewBubblePosition(null);
    setStatus(aiReview.action === 'summarize' ? 'Summary discarded' : 'Improvement discarded');
  }

  async function runRagQuery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = ragQuery.trim();
    if (!query || !document) return;

    const userMessage: RagChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: query,
      timestamp: new Date().toISOString(),
    };
    const assistantMessage: RagChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      timestamp: new Date().toISOString(),
    };
    setRagMessages((messages) => [...messages, userMessage, assistantMessage]);
    ragShouldStickToBottomRef.current = true;
    setRagStatus('asking');
    setRagQuery('');
    try {
      let streamedAnswer = '';
      await retrievalApi.streamQuery(
        {
          query,
          documentId: document.id,
          modelId: selectedModelId,
        },
        (streamEvent) => {
          if (streamEvent.type === 'citations') {
            setCitations(streamEvent.citations);
          }
          if (streamEvent.type === 'delta') {
            streamedAnswer += streamEvent.text;
            setRagMessages((messages) =>
              messages.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, text: `${message.text}${streamEvent.text}` }
                  : message,
              ),
            );
          }
          if (streamEvent.type === 'error') {
            throw new Error(streamEvent.message);
          }
          if (streamEvent.type === 'done') {
            const finalAnswer = streamEvent.answer || streamedAnswer;
            setRagMessages((messages) =>
              messages.map((message) =>
                message.id === assistantMessage.id ? { ...message, text: finalAnswer } : message,
              ),
            );
          }
        },
      );
      setRagStatus('idle');
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Retrieval query failed.';
      setRagMessages((messages) => [
        ...messages.filter((message) => message.id !== assistantMessage.id),
        { ...assistantMessage, text: `${message} Check that the backend is running and your uploaded references have been indexed.` },
      ]);
      setRagStatus('error');
    }
  }

  function createSnapshot() {
    if (document?.extension === '.pdf') return;
    const next: Snapshot = {
      id: crypto.randomUUID(),
      label: `Snapshot #${snapshots.length + 1}`,
      timestamp: new Date().toISOString(),
      content,
    };
    setSnapshots((prev) => [next, ...prev].slice(0, 8));
  }

  function restoreSnapshot(snapshot: Snapshot) {
    setContent(snapshot.content);
    editor?.commands.setContent(toEditorHtml(snapshot.content), { emitUpdate: false });
    if (editor) setPlainText(editor.getText({ blockSeparator: ' ' }));
    setStatus(`Restored ${snapshot.label}`);
  }

  if (!document) {
    return (
      <main className="empty-state">
        <h1>No documents yet</h1>
        <button className="primary-button" onClick={onCreateDocument}>New document</button>
      </main>
    );
  }

  return (
    <main className={`app-shell ${focusMode ? 'focus-mode' : ''}`}>
      <header className="topbar">
        <button className="workspace-switcher" onClick={onShowHome}>AI Text Editor</button>
        <nav className="topbar-menu" aria-label="File menu">
          <button onClick={onCreateDocument}>New</button>
          <button onClick={createSnapshot} disabled={isPdfDocument} title={isPdfDocument ? 'PDF assets do not support snapshots' : 'Snapshot'}>
            Snapshot
          </button>
          <button onClick={() => setRightTab('files')}>Files</button>
        </nav>
        <div className="topbar-spacer" />
        <button className="topbar-download-button" onClick={() => saveDocumentAs(document)} title={`Download ${document.name}${document.extension}`}>
          Download
        </button>
        <button className="theme-toggle" onClick={onToggleTheme}>
          {theme === 'light' ? 'Dark mode' : 'Light mode'}
        </button>
      </header>

      <aside className="left-sidebar">
        <section className="sidebar-section">
          <div className="section-heading">
            <span>MY DOCS</span>
            <div className="icon-row">
              <button title="New folder" onClick={onCreateFolder}><span className="folder-add-icon" /></button>
              <button title="Upload file" onClick={() => treeUploadInputRef.current?.click()}>
                <span className="upload-arrow-icon tree-upload-arrow" aria-hidden="true" />
              </button>
              <input
                ref={treeUploadInputRef}
                type="file"
                hidden
                accept=".pdf,.md,.txt"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                  event.currentTarget.value = '';
                }}
              />
            </div>
          </div>
          <div className="tree-list" onClick={() => setContextMenu(null)}>
            {Object.entries(groupedDocuments).sort(([a], [b]) => a.localeCompare(b)).filter(([folder]) => !isFolderHidden(folder)).map(([folder, docs]) => (
              <div key={folder} className="folder-group">
                <button
                  className={`folder-row ${selectedFolder === folder ? 'selected' : ''}`}
                  style={{ paddingLeft: 8 + folderDepth(folder) * 14 }}
                  onClick={() => onSelectFolder(folder)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ type: 'folder', path: folder, x: event.clientX, y: event.clientY });
                  }}
                  title={folder}
                >
                  <span className="folder-caret">{collapsedFolders.includes(folder) ? '>' : 'v'}</span>
                  {renaming?.type === 'folder' && renaming.id === folder ? (
                    <input
                      value={renaming.value}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setRenaming({ ...renaming, value: event.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename();
                        if (event.key === 'Escape') setRenaming(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <strong>{folderName(folder)}</strong>
                  )}
                </button>
                {renaming?.type === 'folder' && renaming.id === folder && renaming.error && <small className="rename-error">{renaming.error}</small>}
                {!collapsedFolders.includes(folder) && docs.map((doc) => (
                  <button
                    key={doc.id}
                    className={`tree-item ${doc.id === document.id ? 'active' : ''}`}
                    style={{ paddingLeft: 24 + folderDepth(folder) * 14 }}
                    onClick={() => onSelectDocument(doc.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ type: 'file', id: doc.id, x: event.clientX, y: event.clientY });
                    }}
                    draggable
                    title={`${doc.name}${doc.extension}`}
                  >
                    <span className="doc-icon">{doc.extension === '.pdf' ? 'PDF' : doc.extension.slice(1).toUpperCase()}</span>
                    {renaming?.type === 'file' && renaming.id === doc.id ? (
                      <input
                        value={renaming.value}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setRenaming({ ...renaming, value: event.target.value })}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename();
                          if (event.key === 'Escape') setRenaming(null);
                        }}
                        autoFocus
                      />
                    ) : (
                      <span>{doc.name}</span>
                    )}
                  </button>
                ))}
                {renaming?.type === 'file' && docs.some((doc) => doc.id === renaming.id) && renaming.error && <small className="rename-error">{renaming.error}</small>}
              </div>
            ))}
            {contextMenu && (
              <div className="tree-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
                {contextMenu.type === 'file' && (
                  <button
                    onClick={() => {
                      const target = documents.find((doc) => doc.id === contextMenu.id);
                      if (target) saveDocumentAs(target);
                    }}
                  >
                    Download
                  </button>
                )}
                <button
                  disabled={
                    (contextMenu.type === 'folder' && isProtectedFolder(contextMenu.path)) ||
                    (contextMenu.type === 'file' && documents.find((doc) => doc.id === contextMenu.id)?.extension === '.pdf')
                  }
                  onClick={() => {
                    if (contextMenu.type === 'file') {
                      const target = documents.find((doc) => doc.id === contextMenu.id);
                      if (target) startRenameFile(target);
                    } else {
                      startRenameFolder(contextMenu.path);
                    }
                  }}
                >
                  Rename
                </button>
                <button
                  disabled={contextMenu.type === 'folder' && isProtectedFolder(contextMenu.path)}
                  onClick={() => {
                    if (contextMenu.type === 'file') onRemoveDocument(contextMenu.id);
                    if (contextMenu.type === 'folder') onDeleteFolder(contextMenu.path);
                    setContextMenu(null);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="sidebar-section snapshots">
          <div className="section-heading">
            <span>SNAPSHOTS</span>
            <button onClick={createSnapshot} disabled={isPdfDocument} title={isPdfDocument ? 'PDF assets do not support snapshots' : 'Create snapshot'}>
              +
            </button>
          </div>
          <div className="timeline">
            {snapshots.length ? snapshots.map((snapshot) => (
              <button key={snapshot.id} className="snapshot-row" onClick={() => restoreSnapshot(snapshot)}>
                <span className="snapshot-label">{snapshot.label}</span>
                <small>{new Date(snapshot.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
              </button>
            )) : <p className="muted">No snapshots yet.</p>}
          </div>
        </section>
      </aside>

      <section className="editor-column">
        {isPdfDocument ? (
          <div className="pdf-asset-viewer">
            <div>
              <span className="doc-icon">PDF</span>
              <h2>{document.name}</h2>
              <p>PDF files are used as RAG reference assets only and cannot be edited directly.</p>
              <small>The chat window will use this selected PDF as its reference source.</small>
            </div>
          </div>
        ) : (
          <>
        <div className="toolbar" aria-label="Editor toolbar">
          {isPlainTextDocument ? (
            <span className="plain-text-toolbar-note">Plain text mode - rich formatting disabled</span>
          ) : (
            <>
          <button className={toolbarButtonClass(editor?.isActive('bold'))} title="Bold (Ctrl+B)" onClick={() => focusEditor()?.toggleBold().run()}><strong>B</strong></button>
          <button className={toolbarButtonClass(editor?.isActive('italic'))} title="Italic (Ctrl+I)" onClick={() => focusEditor()?.toggleItalic().run()}><em>I</em></button>
          <button className={toolbarButtonClass(editor?.isActive('strike'))} title="Strikethrough (Ctrl+Shift+X)" onClick={() => focusEditor()?.toggleStrike().run()}><span className="strike-icon">S</span></button>
          <button className={toolbarButtonClass(editor?.isActive('underline'))} title="Underline (Ctrl+U)" onClick={() => focusEditor()?.toggleUnderline().run()}><span className="underline-icon">U</span></button>
          <button className={toolbarButtonClass(editor?.isActive('code'))} title="Inline code (Ctrl+E)" onClick={() => focusEditor()?.toggleCode().run()}><span className="toolbar-icon icon-code-lines" /></button>
          <button className={toolbarButtonClass(editor?.isActive('blockquote'))} title="Blockquote (Ctrl+Shift+B)" onClick={() => focusEditor()?.toggleBlockquote().run()}><span className="toolbar-icon icon-quote-box">"</span></button>
          <button className={toolbarButtonClass(editor?.isActive('bulletList'))} title="Bullet list" onClick={() => focusEditor()?.toggleBulletList().run()}><span className="toolbar-icon icon-list-lines" /></button>
          <button className={toolbarButtonClass(editor?.isActive('orderedList'))} title="Ordered list" onClick={() => focusEditor()?.toggleOrderedList().run()}><span className="ordered-list-icon">1.</span></button>
          <button className={toolbarButtonClass(isAlignActive('left'))} title="Align left" onClick={() => focusEditor()?.setTextAlign('left').run()}><span className="toolbar-icon align-icon align-left" /></button>
          <button className={toolbarButtonClass(isAlignActive('center'))} title="Align center" onClick={() => focusEditor()?.setTextAlign('center').run()}><span className="toolbar-icon align-icon align-center" /></button>
          <button className={toolbarButtonClass(isAlignActive('right'))} title="Align right" onClick={() => focusEditor()?.setTextAlign('right').run()}><span className="toolbar-icon align-icon align-right" /></button>
          <select
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'p') focusEditor()?.setParagraph().run();
              if (value === 'h1') focusEditor()?.toggleHeading({ level: 1 }).run();
              if (value === 'h2') focusEditor()?.toggleHeading({ level: 2 }).run();
              if (value === 'h3') focusEditor()?.toggleHeading({ level: 3 }).run();
            }}
            value={activeHeading}
            aria-label="Heading"
          >
            <option value="p">Text</option>
            <option value="h1">H1</option>
            <option value="h2">H2</option>
            <option value="h3">H3</option>
          </select>
          <select defaultValue="20" aria-label="Font size">
            <option value="4">18</option>
            <option value="5">20</option>
            <option value="6">24</option>
          </select>
          <button className={toolbarButtonClass(editor?.isActive('highlight'))} title="Highlight" onClick={() => focusEditor()?.toggleHighlight({ color: '#fff1a8' }).run()}><span className="highlight-icon">H</span></button>
            </>
          )}
        </div>

        <div className="paper-wrap">
          <article className="paper" onMouseDown={focusEditorFromPaper}>
            <h1 className="document-title">{document.name}</h1>
            {!isPlainTextDocument && <HeaderHighlighter headers={headers} onHeaderClick={jumpToHeader} />}
            <EditorContent editor={editor} />
          </article>
        </div>

        <footer className="bottom-panel">
          <div>
            <strong>{words.toLocaleString()}</strong>
            <span>words</span>
          </div>
          <div>
            <strong>{readingTime(words)} min</strong>
            <span>read time</span>
          </div>
          <span className="save-state">{status}</span>
        </footer>
          </>
        )}
      </section>

      <aside className="right-panel">
        <div className="panel-tabs">
          <button className={rightTab === 'ai' ? 'active' : ''} onClick={() => setRightTab('ai')}>AI</button>
          <button className={rightTab === 'files' ? 'active' : ''} onClick={() => setRightTab('files')}>Files</button>
        </div>

        {rightTab === 'ai' ? (
          <>
            <ModelSelector models={models} selectedModelId={selectedModelId} onChange={onModelChange} />
            <TokenUsageIndicator
              queryTokens={queryTokens}
              retrievedTokens={snippetTokens}
              maxTokens={selected?.maxContextTokens ?? 8000}
            />
            <section className="rag-chat-panel" aria-label="Reference chat">
              <div
                className="rag-chat-messages"
                ref={ragMessagesRef}
                onScroll={(event) => {
                  const node = event.currentTarget;
                  ragShouldStickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 36;
                }}
              >
                {ragMessages.length ? ragMessages.map((message) => (
                  <article key={message.id} className={`rag-message ${message.role}${message.role === 'assistant' && !message.text ? ' pending' : ''}`}>
                    <p>{message.text || 'Searching references...'}</p>
                    <small>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                  </article>
                )) : (
                  <p className="muted">Ask a question about your uploaded reference files.</p>
                )}
              </div>
              <form className="rag-query-box" onSubmit={runRagQuery}>
                <textarea
                  id="rag-query"
                  value={ragQuery}
                  onChange={(event) => setRagQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Ask uploaded references..."
                  rows={3}
                />
                <button
                  className="primary-button"
                  disabled={!ragQuery.trim() || ragStatus === 'asking'}
                  title="Ask references (Enter)"
                >
                  {ragStatus === 'asking' ? 'Asking...' : 'Ask'}
                </button>
              </form>
            </section>
            {!isPdfDocument && (
              <>
                <div className="selection-box">
                  <span>Selection</span>
                  <p>{selectionText || 'Select a passage in the document.'}</p>
                </div>
                <div className="ai-actions">
                  <button
                    className="primary-button"
                    onClick={() => runAction('summarize')}
                    disabled={Boolean(aiActionStatus)}
                  >
                    {aiActionStatus === 'summarize' ? 'Summarizing...' : 'Summarize'}
                  </button>
                  <button onClick={() => runAction('improve')} disabled={Boolean(aiActionStatus)}>
                    {aiActionStatus === 'improve' ? 'Improving...' : 'Improve'}
                  </button>
                </div>
              </>
            )}
            <section className="citation-list">
              <h3>Referenced Files</h3>
              {Object.keys(groupedCitations).length ? Object.entries(groupedCitations).map(([file, fileCitations]) => (
                <article key={file} className="citation citation-group">
                  <strong>{file}</strong>
                  <div className="citation-snippets">
                    {fileCitations.map((citation) => (
                      <p key={citation.id}>{citation.snippet}</p>
                    ))}
                  </div>
                </article>
              )) : <p className="muted">No referenced files yet.</p>}
            </section>
          </>
        ) : (
          <FilesTab files={files} onUpload={onUpload} onRemove={onRemoveDocument} />
        )}
      </aside>
      {txtWarningVisible && (
        <div className="modal-backdrop" role="presentation">
          <section className="new-document-modal confirm-modal" aria-label="Plain text warning">
            <h2>Plain text document</h2>
            <p>
              .txt files are plain-text import/export documents. Formatting changes like headings,
              bold, lists, or colors may not persist unless you save or export as .md.
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={suppressTxtWarning}
                onChange={(event) => {
                  setSuppressTxtWarning(event.target.checked);
                  localStorage.setItem('ai-text-editor.suppressTxtWarning', String(event.target.checked));
                }}
              />
              Do not show again
            </label>
            <div className="modal-actions">
              <button className="modal-create-button" onClick={() => setTxtWarningVisible(false)}>Got it</button>
            </div>
          </section>
        </div>
      )}
      {aiReview && reviewBubblePosition && (
        <div
          className="ai-review-bubble"
          style={{ top: reviewBubblePosition.top, left: reviewBubblePosition.left }}
          role="group"
          aria-label="Review AI edit"
        >
          <button className="primary-button" onClick={applyAiReview}>Apply</button>
          <button onClick={discardAiReview}>Discard</button>
        </div>
      )}
    </main>
  );
}
