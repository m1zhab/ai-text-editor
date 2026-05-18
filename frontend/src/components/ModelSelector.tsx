import type { ModelProfile } from '../types';

interface Props {
  models: ModelProfile[];
  selectedModelId: string;
  onChange: (modelId: string) => void;
}

export function ModelSelector({ models, selectedModelId, onChange }: Props) {
  return (
    <label className="field-label">
      <span>Model profile</span>
      <select value={selectedModelId} onChange={(e) => onChange(e.target.value)}>
        {models.map((model) => (
          <option key={model.modelId} value={model.modelId}>
            {model.profileName}
          </option>
        ))}
      </select>
    </label>
  );
}
