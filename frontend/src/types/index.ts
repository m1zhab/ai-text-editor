export interface DocumentItem {
  id: string;
  name: string;
  updatedAt: string;
  kind: 'document' | 'asset';
  extension: '.md' | '.txt' | '.pdf';
  content?: string;
}

export interface ChatCitation {
  id: string;
  sourceDocumentId: string;
  title: string;
  snippet: string;
}

export interface ChatReply {
  text: string;
  citations: ChatCitation[];
}

export interface ModelProfile {
  profileName: string;
  modelId: string;
  maxContextTokens: number;
}
