interface Props {
  text: string;
}

const headerRegex = /^(#+\s+.+)$/gm;

export function HeaderHighlighter({ text }: Props) {
  const lines = text.split('\n');
  const joined = lines.join('\n');
  const hasHeaders = headerRegex.test(joined);

  return (
    <div>
      <strong>Header Detection:</strong> {hasHeaders ? 'Headers detected and highlighted' : 'No headers yet'}
    </div>
  );
}
