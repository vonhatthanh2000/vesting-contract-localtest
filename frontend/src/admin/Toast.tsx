import { useEffect } from 'react';

export type ToastMsg = { id: number; kind: 'error' | 'success'; text: string };

export function Toasts({ items, onDismiss }: { items: ToastMsg[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed right-4 top-4 z-50 flex w-96 flex-col gap-2">
      {items.map((t) => (
        <ToastItem key={t.id} t={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ t, onDismiss }: { t: ToastMsg; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const h = setTimeout(() => onDismiss(t.id), t.kind === 'error' ? 8000 : 3000);
    return () => clearTimeout(h);
  }, [t, onDismiss]);
  const color = t.kind === 'error' ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800';
  return (
    <div role={t.kind === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-2 rounded border px-3 py-2 text-sm shadow ${color}`}>
      <span>{t.text}</span>
      <button aria-label="Dismiss" className="opacity-60 hover:opacity-100" onClick={() => onDismiss(t.id)}>×</button>
    </div>
  );
}
