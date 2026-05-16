import { http } from './http';
import type { ChatReply } from '../types';

export type ChatAction = 'summarize' | 'improve';

export const chatApi = {
  ask: (payload: {
    documentId: string;
    action: ChatAction;
    selectedText: string;
    modelId: string;
  }) => http.request<ChatReply>('/chat', { method: 'POST', body: JSON.stringify(payload) }),
};
