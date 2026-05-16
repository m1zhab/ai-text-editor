import type { DocumentItem } from '../types';

interface Props {
  items: DocumentItem[];
  onOpen: (doc: DocumentItem) => void;
}

export function DocumentGrid({ items, onOpen }: Props) {
  return (
    <section>
      <h2>Documents & Assets</h2>
      <div className="grid">
        {items.map((item) => (
          <button key={item.id} className="card" onClick={() => onOpen(item)}>
            <h4>{item.name}</h4>
            <p>{item.kind} • {item.extension}</p>
            <small>Updated: {new Date(item.updatedAt).toLocaleString()}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
