import { useRef, type PointerEvent, type MouseEvent } from "react";

export function haptic(duration: number) {
  navigator.vibrate?.(duration);
}

export function useRowActions() {
  const active = useRef<{ key: string; pointer: number; x: number; y: number; timer: number }>(null);
  const ignore = useRef<{ key: string; until: number }>(null);
  function clear() {
    if (active.current) window.clearTimeout(active.current.timer);
    active.current = null;
  }
  return (key: string, open: () => void) => {
    function reveal() {
      ignore.current = { key, until: Date.now() + 500 };
      haptic(12);
      open();
    }
    return {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest(".actions, .row-menu")) return;
        clear();
        ignore.current = null;
        active.current = {
          key, pointer: event.pointerId, x: event.clientX, y: event.clientY,
          timer: window.setTimeout(() => { clear(); reveal(); }, 500),
        };
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const start = active.current;
        if (start?.key !== key || start.pointer !== event.pointerId) return;
        if (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10)
          window.clearTimeout(start.timer);
      },
      onPointerCancel: clear,
      onPointerLeave: clear,
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const start = active.current;
        clear();
        if (start?.key === key && event.clientX - start.x < -55 && Math.abs(event.clientY - start.y) < 30) reveal();
      },
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (ignore.current?.key === key && ignore.current.until > Date.now()) {
          ignore.current = null;
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
