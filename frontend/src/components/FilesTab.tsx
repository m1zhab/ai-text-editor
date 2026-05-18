import { useRef } from 'react';
import type { DocumentItem } from '../types';

interface Props {
  files: DocumentItem[];
  onUpload: (file: File) => void;
  onRemove: (id: string) => void;
}

export function FilesTab({ files, onUpload, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="files-tab">
      <div className="section-heading">
        <span>FILES</span>
        <button title="Upload file" onClick={() => inputRef.current?.click()}>+</button>
      </div>
      <button className="upload-drop" onClick={() => inputRef.current?.click()}>
        <strong>Upload PDF, MD, or TXT</strong>
        <span>Files are added to the explorer and opened as documents.</span>
      </button>
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
      <div className="file-list">
        {files.map((file) => (
          <article key={file.id} className="file-row">
            <span className="doc-icon">{file.extension.slice(1).toUpperCase()}</span>
            <div>
              <strong>{file.name}</strong>
              <small>{new Date(file.updatedAt).toLocaleDateString()}</small>
            </div>
            <button title="Delete" onClick={() => onRemove(file.id)}>x</button>
          </article>
        ))}
      </div>
    </section>
  );
}
