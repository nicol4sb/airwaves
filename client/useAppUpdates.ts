import { useCallback, useEffect, useRef, useState } from "react";

export function useAppUpdates() {
  const [updateReady, setUpdateReady] = useState(false);
  const checking = useRef(false);
  const lastCheck = useRef(-Infinity);
  const checkForUpdate = useCallback(async (force = false) => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator) || checking.current) return;
    if (!force && performance.now() - lastCheck.current < 15 * 60_000) return;
    checking.current = true;
    lastCheck.current = performance.now();
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      if (!registration.installing) await registration.update();
    } catch {
      lastCheck.current = -Infinity;
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const workers = navigator.serviceWorker;
    let previous = workers.controller;
    const changed = () => {
      if (previous && workers.controller && previous !== workers.controller) setUpdateReady(true);
      previous = workers.controller;
    };
    workers.addEventListener("controllerchange", changed);
    void checkForUpdate();
    return () => workers.removeEventListener("controllerchange", changed);
  }, [checkForUpdate]);

  return { updateReady, checkForUpdate };
}
