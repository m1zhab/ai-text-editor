import { http } from './http';
import type { ChatCitation } from '../types';

export const retrievalApi = {
  citations: (documentId: string) =>
    http.request<ChatCitation[]>(`/retrieval/citations?documentId=${encodeURIComponent(documentId)}`),
};
