import { http } from './http';
import type { ModelProfile } from '../types';

export const modelsApi = {
  list: () => http.request<ModelProfile[]>('/models'),
};
