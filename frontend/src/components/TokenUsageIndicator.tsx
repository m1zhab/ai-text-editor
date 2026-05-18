interface Props {
  queryTokens: number;
  retrievedTokens: number;
  maxTokens: number;
}

export function TokenUsageIndicator({ queryTokens, retrievedTokens, maxTokens }: Props) {
  const used = queryTokens + retrievedTokens;
  const usage = Math.min((used / maxTokens) * 100, 100);
  return (
    <div className="token-card">
      <div className="token-head">
        <strong>Context usage</strong>
        <span>{Math.round(usage)}%</span>
      </div>
      <div className="token-meter">
        <span style={{ width: `${usage}%` }} />
      </div>
      <small>{queryTokens} query + {retrievedTokens} retrieved / {maxTokens} tokens</small>
    </div>
  );
}
