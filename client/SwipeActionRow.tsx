import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { haptic, useRowActions } from "./rowActions";

export default function SwipeActionRow({ title, options, remove, removeLabel, children }: {
  title: string;
  options: () => void;
  remove: () => void;
  removeLabel: string;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const rowActions = useRowActions();
  const actions = rowActions(title, options, show => {
    if (show && !open) haptic(12);
    setOpen(show);
  });
  useEffect(() => {
    const surface = content.current;
    if (!surface) return;
    // Native horizontal panning can consume the next tap as a fling stop.
    const move = (event: TouchEvent) => {
      if (event.cancelable && surface.hasAttribute("data-dragging")) event.preventDefault();
    };
    surface.addEventListener("touchmove", move, { passive: false });
    return () => surface.removeEventListener("touchmove", move);
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!row.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  return (
    <div className="swipe-row" ref={row} data-open={open || undefined}
      onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
      <button className="swipe-remove" disabled={!open} aria-hidden={!open} onClick={() => {
        setOpen(false);
        remove();
      }}><Trash2 size={18} />{removeLabel}</button>
      <div ref={content} className="swipe-content" {...actions} onClickCapture={event => {
        actions.onClickCapture(event);
        if (open && !event.defaultPrevented && !(event.target as Element).closest(".row-menu")) {
          event.stopPropagation();
          setOpen(false);
        }
      }}>
        {children}
        <button className="row-menu" aria-label={"Options for " + title} onClick={() => {
          setOpen(false);
          options();
        }}><MoreHorizontal size={20} /></button>
      </div>
    </div>
  );
}
