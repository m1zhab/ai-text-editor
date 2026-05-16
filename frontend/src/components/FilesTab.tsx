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
    <section>
      <h3>Files</h3>
      <button onClick={() => inputRef.current?.click()}>Upload .pdf/.md/.txt</button>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept=".pdf,.md,.txt"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
        }}
      />
      <ul>
        {files.map((file) => (
          <li key={file.id}>
            {file.name} ({file.extension})
            <button onClick={() => onRemove(file.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
