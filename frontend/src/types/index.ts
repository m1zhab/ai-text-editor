export interface DocumentItem {
  id: string;
  name: string;
  updatedAt: string;
  kind: 'document' | 'asset';
  extension: '.md' | '.txt' | '.pdf';
  content?: string;
  folder?: string;
}

export interface ChatCitation {
  id: string;
  sourceDocumentId: string;
  title: string;
  snippet: string;
  file?: string;
  chunk_id?: string;
}

export interface ChatReply {
  text: string;
  citations: ChatCitation[];
}

export interface RetrievalQueryReply {
  answer: string;
  citations: ChatCitation[];
}

export interface ModelProfile {
  profileName: string;
  modelId: string;
  maxContextTokens: number;
}
