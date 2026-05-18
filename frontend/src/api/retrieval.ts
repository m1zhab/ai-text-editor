import { http } from './http';
import type { ChatCitation, RetrievalQueryReply } from '../types';

export type RetrievalStreamEvent =
  | { type: 'citations'; citations: ChatCitation[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; answer: string; metadata?: Record<string, unknown> }
  | { type: 'error'; message: string };

export const retrievalApi = {
  citations: (documentId: string) =>
    http.request<ChatCitation[]>(`/retrieval/citations?documentId=${encodeURIComponent(documentId)}`),
  query: (payload: { query: string; documentId?: string; modelId: string }) =>
    http.request<RetrievalQueryReply>('/retrieval/query', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  streamQuery: async (
    payload: { query: string; documentId?: string; modelId: string },
    onEvent: (event: RetrievalStreamEvent) => void,
  ) => {
    const response = await fetch('/api/retrieval/query/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok || !response.body) throw new Error(`Streaming request failed: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.filter(Boolean).forEach((line) => {
        try {
          onEvent(JSON.parse(line) as RetrievalStreamEvent);
        } catch {
          throw new Error('Streaming response was not valid JSON');
        }
      });
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer) as RetrievalStreamEvent);
  },
};
