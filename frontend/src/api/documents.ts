import { http } from './http';
import type { DocumentItem } from '../types';

export const documentsApi = {
  list: () => http.request<DocumentItem[]>('/documents'),
  get: (id: string) => http.request<DocumentItem>(`/documents/${id}`),
  create: (payload: Pick<DocumentItem, 'name' | 'extension' | 'content'>) =>
    http.request<DocumentItem>('/documents', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: string, payload: Partial<Pick<DocumentItem, 'name' | 'content'>>) =>
    http.request<DocumentItem>(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  remove: (id: string) => http.request<{ ok: true }>(`/documents/${id}`, { method: 'DELETE' }),
  uploadAsset: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/documents/upload', { method: 'POST', body: formData }).then((res) => {
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return res.json() as Promise<DocumentItem>;
    });
  },
};
