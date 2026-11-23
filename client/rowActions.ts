import { useEffect, useRef, type PointerEvent, type MouseEvent } from "react";

export function haptic(duration: number) {
  navigator.vibrate?.(duration);
}

export function useRowActions() {
  const active = useRef<{ key: string; pointer: number; x: number; y: number; timer: number; row: HTMLElement; dragging: boolean }>(null);
  const ignoreClick = useRef<string | null>(null);
  useEffect(() => () => window.clearTimeout(active.current?.timer), []);
  function clear() {
    if (active.current) {
      window.clearTimeout(active.current.timer);
      active.current.row.style.removeProperty("--swipe-offset");
      active.current.row.removeAttribute("data-dragging");
    }
    active.current = null;
  }
  return (key: string, open: () => void, swipe?: (show: boolean) => void) => {
    function reveal() {
      ignoreClick.current = key;
      haptic(12);
      open();
    }
    return {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!event.isPrimary || event.button !== 0) return;
        clear();
        ignoreClick.current = null;
        if ((event.target as Element).closest(".actions, .row-menu")) return;
        const row = event.currentTarget;
        active.current = {
          key, pointer: event.pointerId, x: event.clientX, y: event.clientY, row, dragging: false,
          timer: window.setTimeout(() => {
            clear();
            if (row.isConnected) reveal();
          }, 500),
        };
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const start = active.current;
        if (start?.key !== key || start.pointer !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!start.dragging && Math.max(Math.abs(dx), Math.abs(dy)) <= 10) return;
        window.clearTimeout(start.timer);
        if (!swipe) return;
        if (!start.dragging && Math.abs(dy) >= Math.abs(dx)) return clear();
        if (!start.dragging) start.row.setPointerCapture(event.pointerId);
        start.dragging = true;
        start.row.setAttribute("data-dragging", "");
        start.row.style.setProperty("--swipe-offset", dx + "px");
      },
      onPointerCancel: clear,
      onPointerLeave: clear,
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const start = active.current;
        if (start?.key !== key || start.pointer !== event.pointerId) return;
        clear();
        const dx = event.clientX - start.x;
        const horizontal = Math.abs(dx) > 55 && Math.abs(event.clientY - start.y) < 30;
        if (swipe && (start.dragging || horizontal)) {
          ignoreClick.current = key;
          if (Math.abs(dx) > 55) swipe(dx < 0);
        } else if (horizontal && dx < 0) reveal();
      },
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (event.detail > 0 && ignoreClick.current === key) {
          ignoreClick.current = null;
          event.preventDefault();
          event.stopPropagation();
        }
      },
      onContextMenu(event: MouseEvent<HTMLElement>) {
        event.preventDefault();
      },
    };
  };
}
