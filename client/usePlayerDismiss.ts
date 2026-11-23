import { useCallback, useLayoutEffect, useRef } from "react";

export function usePlayerDismiss(open: boolean, dismiss: () => void) {
  const sheet = useRef<HTMLElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const dismissing = useRef(false);

  const finish = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    dismiss();
  }, [dismiss]);

  const close = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    const backdrop = sheet.current?.parentElement;
    if (!backdrop || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    backdrop.removeAttribute("data-dragging");
    backdrop.setAttribute("data-dismissing", "");
    closeTimer.current = window.setTimeout(finish, 350);
  }, [finish]);

  useLayoutEffect(() => {
    const element = sheet.current;
    const parent = element?.parentElement;
    if (!open || !element || !parent) return;
    const panel = element;
    const backdrop = parent;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let start: { id: number; x: number; y: number; time: number } | undefined;
    let dragging = false;
    let travel = 0;

    function reset() {
      start = undefined;
      dragging = false;
      backdrop.removeAttribute("data-dragging");
      backdrop.style.removeProperty("--player-offset");
      backdrop.style.removeProperty("--player-dim");
    }

    function begin(event: TouchEvent) {
      if (dismissing.current) return;
      reset();
      if (event.touches.length !== 1 || panel.scrollTop > 0
        || (event.target as Element).closest("button, input, select, a, textarea")) return;
      const touch = event.touches[0];
      start = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp };
      travel = backdrop.clientHeight;
    }

    function move(event: TouchEvent) {
      if (!start || dismissing.current) return;
      if (event.touches.length !== 1) return reset();
      const touch = event.touches[0];
      const down = touch.clientY - start.y;
      const across = Math.abs(touch.clientX - start.x);
      if (!dragging) {
        if (Math.max(Math.abs(down), across) < 8) return;
        if (down <= across || !event.cancelable) return reset();
        dragging = true;
      }
      if (!event.cancelable) return reset();
      event.preventDefault();
      if (reducedMotion.matches) return;
      const distance = Math.max(0, down);
      backdrop.setAttribute("data-dragging", "");
      backdrop.style.setProperty("--player-offset", distance + "px");
      backdrop.style.setProperty("--player-dim", String(Math.max(0, 1 - distance / travel)));
    }

    function release(event: TouchEvent) {
      const gesture = start;
      if (!gesture || dismissing.current) return;
      const touch = Array.from(event.changedTouches).find(point => point.identifier === gesture.id);
      if (dragging && touch) {
        const distance = touch.clientY - gesture.y;
        const fast = distance > 32 && distance / Math.max(1, event.timeStamp - gesture.time) > 0.65;
        if (distance > 96 || fast) {
          start = undefined;
          dragging = false;
          close();
          return;
        }
      }
      reset();
    }

    panel.addEventListener("touchstart", begin, { passive: true });
    panel.addEventListener("touchmove", move, { passive: false });
    panel.addEventListener("touchend", release);
    panel.addEventListener("touchcancel", reset);
    function endTransition(event: TransitionEvent) {
      if (event.target === panel && event.propertyName === "transform" && dismissing.current) finish();
    }
    panel.addEventListener("transitionend", endTransition);
    return () => {
      panel.removeEventListener("touchstart", begin);
      panel.removeEventListener("touchmove", move);
      panel.removeEventListener("touchend", release);
      panel.removeEventListener("touchcancel", reset);
      panel.removeEventListener("transitionend", endTransition);
      reset();
      backdrop.removeAttribute("data-dismissing");
      window.clearTimeout(closeTimer.current);
      dismissing.current = false;
    };
  }, [open, close, finish]);

  return { sheet, close };
}
