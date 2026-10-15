import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { X } from "lucide-react";
export function VirtualList<T>({
  items,
  height = 400,
  rowHeight = 52,
  render,
  label,
}: {
  items: T[];
  height?: number | string;
  rowHeight?: number;
  render: (item: T, index: number) => ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const virtual = useVirtualizer({
    count: items.length,
    initialRect: {
      width: 150,
      height: typeof height === "number" ? height : 400,
    },
    getItemKey: (i) => {
      const item = items[i] as { id?: string } | undefined;
      return item?.id ?? i;
    },
    getScrollElement: () => ref.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });
  return (
    <div
      ref={ref}
      className="virtual-list"
      role="region"
      tabIndex={0}
      style={{ height }}
      aria-label={label}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).matches("input,textarea,select")) return;
        if (["j", "k", "ArrowDown", "ArrowUp"].includes(e.key)) {
          e.preventDefault();
          const next = Math.max(
            0,
            Math.min(
              items.length - 1,
              index + (["j", "ArrowDown"].includes(e.key) ? 1 : -1),
            ),
          );
          setIndex(next);
          virtual.scrollToIndex(next);
          requestAnimationFrame(() =>
            ref.current
              ?.querySelector<HTMLElement>(`[data-row="${next}"] button`)
              ?.focus(),
          );
        }
      }}
    >
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((v) => (
          <div
            key={v.key}
            data-row={v.index}
            onFocus={() => setIndex(v.index)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: rowHeight,
              transform: `translateY(${v.start}px)`,
            }}
          >
            {render(items[v.index], v.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  sheet = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  sheet?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => prev?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className={sheet ? "sheet" : "command-dialog"}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-header">
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}
