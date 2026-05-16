interface Props {
  documentTokens: number;
  snippetTokens: number;
  maxTokens: number;
}

export function TokenUsageIndicator({ documentTokens, snippetTokens, maxTokens }: Props) {
  const used = documentTokens + snippetTokens;
  const usage = Math.min((used / maxTokens) * 100, 100);
  return (
    <div>
      <strong>Context Usage</strong>
      <div>{documentTokens} doc + {snippetTokens} retrieved / {maxTokens} tokens</div>
      <progress max={100} value={usage} />
    </div>
  );
}
