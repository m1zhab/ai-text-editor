import { useEffect, useMemo, useState } from 'react';
import './styles.css';
import { documentsApi } from './api/documents';
import { modelsApi } from './api/models';
import { DocumentGrid } from './pages/DocumentGrid';
import { EditorPage } from './pages/EditorPage';
import { FilesTab } from './components/FilesTab';
import type { DocumentItem, ModelProfile } from './types';

export default function App() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [active, setActive] = useState<DocumentItem | null>(null);
  const [selectedModelId, setSelectedModelId] = useState('');

  useEffect(() => {
    documentsApi.list().then(setDocuments).catch(() => setDocuments([]));
    modelsApi
      .list()
      .then((response) => {
        setModels(response);
        if (response[0]) setSelectedModelId(response[0].modelId);
      })
      .catch(() => setModels([]));
  }, []);

  const files = useMemo(() => documents.filter((doc) => ['.pdf', '.md', '.txt'].includes(doc.extension)), [documents]);

  return (
    <main>
      <header>
        <h1>AI Text Editor</h1>
      </header>
      <FilesTab
        files={files}
        onUpload={async (file) => {
          const uploaded = await documentsApi.uploadAsset(file);
          setDocuments((prev) => [uploaded, ...prev]);
        }}
        onRemove={async (id) => {
          await documentsApi.remove(id);
          setDocuments((prev) => prev.filter((doc) => doc.id !== id));
        }}
      />
      {!active ? (
        <DocumentGrid items={documents} onOpen={setActive} />
      ) : (
        <EditorPage
          document={active}
          models={models}
          selectedModelId={selectedModelId}
          onModelChange={setSelectedModelId}
        />
      )}
    </main>
  );
}
