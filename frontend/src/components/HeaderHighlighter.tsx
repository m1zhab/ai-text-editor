export interface HeaderHighlight {
  level: number;
  text: string;
  color: string;
  position?: number;
}

const colors = ['#e6f4ff', '#fff1a8', '#ffe0ef', '#dff8e7', '#e9e1ff'];

export function getHeaderHighlights(text: string): HeaderHighlight[] {
  return text
    .split('\n')
    .map((line) => {
      const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (!match) return null;
      const level = match[1].length;
      return {
        level,
        text: match[2],
        color: colors[(level + match[2].length) % colors.length],
      };
    })
    .filter((item): item is HeaderHighlight => Boolean(item));
}

export function HeaderHighlighter({
  headers,
  onHeaderClick,
}: {
  headers: HeaderHighlight[];
  onHeaderClick?: (position: number) => void;
}) {
  return (
    <div className="header-strip" aria-label="Detected headers">
      {headers.length ? (
        headers.slice(0, 6).map((header, index) => (
          <button
            key={`${header.level}-${header.text}-${index}`}
            type="button"
            style={{ backgroundColor: header.color }}
            onClick={() => {
              if (typeof header.position === 'number') onHeaderClick?.(header.position);
            }}
          >
            H{header.level} {header.text}
          </button>
        ))
      ) : (
        <span>No markdown headers yet</span>
      )}
    </div>
  );
}
