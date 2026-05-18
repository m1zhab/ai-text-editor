import { useRef } from 'react';
import type { DocumentItem } from '../types';

interface Props {
  items: DocumentItem[];
  onOpen: (doc: DocumentItem) => void;
  onCreate: () => void;
  onUpload: (file: File) => void;
}

const PREVIEW_LIMIT = 130;

function previewText(content?: string): string {
  if (!content) return 'Attached file ready for retrieval.';

  const withoutTags = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const normalized = withoutTags
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/^\s*\n+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  return normalized || 'Attached file ready for retrieval.';
}

function truncatePreview(text: string, limit = PREVIEW_LIMIT): string {
  if (text.length <= limit) return text;

  const candidate = text.slice(0, limit + 1);
  const lastWordBoundary = Math.max(
    candidate.lastIndexOf(' '),
    candidate.lastIndexOf('\n'),
    candidate.lastIndexOf('\t'),
  );

  if (lastWordBoundary <= 0) return '...';
  return `${candidate.slice(0, lastWordBoundary).trimEnd()}...`;
}

export function DocumentGrid({ items, onOpen, onCreate, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <main className="home-shell">
      <header className="home-header">
        <div>
          <h1>AI Text Editor</h1>
          <p>Documents, references, and drafts in one writing workspace.</p>
        </div>
        <div className="home-actions">
          <button onClick={() => inputRef.current?.click()}>Upload</button>
          <button className="primary-button" onClick={onCreate}>New document</button>
        </div>
      </header>

      <input
        ref={inputRef}
        type="file"
        hidden
        accept=".pdf,.md,.txt"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          event.currentTarget.value = '';
        }}
      />

      <section className="document-grid">
        {items.map((item) => (
          <button key={item.id} className="document-card" onClick={() => onOpen(item)}>
            <span className="doc-icon">{item.extension.slice(1).toUpperCase()}</span>
            <h2 title={item.name}>{item.name}</h2>
            <p>{truncatePreview(previewText(item.content))}</p>
            <small>{item.folder ?? 'drafts'} - {new Date(item.updatedAt).toLocaleString()}</small>
          </button>
        ))}
      </section>
    </main>
  );
}
