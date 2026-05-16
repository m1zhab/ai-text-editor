import { useMemo, useState } from 'react';
import { chatApi, type ChatAction } from '../api/chat';
import type { ChatCitation, DocumentItem, ModelProfile } from '../types';
import { HeaderHighlighter } from '../components/HeaderHighlighter';
import { ModelSelector } from '../components/ModelSelector';
import { TokenUsageIndicator } from '../components/TokenUsageIndicator';

interface Props {
  document: DocumentItem;
  models: ModelProfile[];
  selectedModelId: string;
  onModelChange: (value: string) => void;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function EditorPage({ document, models, selectedModelId, onModelChange }: Props) {
  const [content, setContent] = useState(document.content ?? '');
  const [citations, setCitations] = useState<ChatCitation[]>([]);

  const documentTokens = useMemo(() => estimateTokens(content), [content]);
  const snippetTokens = useMemo(
    () => citations.reduce((sum, c) => sum + estimateTokens(c.snippet), 0),
    [citations],
  );
  const selected = models.find((model) => model.modelId === selectedModelId);

  async function runAction(action: ChatAction) {
    const selection = window.getSelection()?.toString().trim() ?? '';
    if (!selection) return;

    const reply = await chatApi.ask({
      documentId: document.id,
      selectedText: selection,
      action,
      modelId: selectedModelId,
    });

    setCitations(reply.citations);
    setContent((prev) => prev.replace(selection, reply.text));
  }

  return (
    <div className="editor-layout">
      <article>
        <h2>{document.name}</h2>
        <HeaderHighlighter text={content} />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={22} />
      </article>
      <aside>
        <h3>AI Assistant</h3>
        <ModelSelector models={models} selectedModelId={selectedModelId} onChange={onModelChange} />
        <TokenUsageIndicator
          documentTokens={documentTokens}
          snippetTokens={snippetTokens}
          maxTokens={selected?.maxContextTokens ?? 8000}
        />
        <div className="actions">
          <button onClick={() => runAction('summarize')}>Summarize Selection</button>
          <button onClick={() => runAction('improve')}>Improve Selection</button>
        </div>
        <h4>Retrieval Citations</h4>
        <ul>
          {citations.map((citation) => (
            <li key={citation.id}>
              <strong>{citation.title}</strong>
              <p>{citation.snippet}</p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
