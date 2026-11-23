import { createRoot } from "react-dom/client";
import App from "./App";
import { profile, profileLabel } from "./profile";
import { stations } from "../shared/radio";
import "./style.css";
if (profile) {
  document.title = "Airwave · " + profileLabel;
  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = profile === "nic" ? "/manifest.webmanifest" : "/manifest-emma.webmanifest";
  document.head.appendChild(manifest);

  // All built-in stations share a host. A HEAD request warms the browser's
  // resolver on launch, even when it skips speculative connection hints.
  let warming = false;
  let lastWarm = -Infinity;
  function warmRadioHost() {
    if (document.hidden || !navigator.onLine || warming) return;
    warming = true;
    lastWarm = performance.now();
    void fetch(stations[0].url, {
      method: "HEAD",
      mode: "no-cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    }).catch(() => {}).finally(() => { warming = false; });
  }
  warmRadioHost();
  window.addEventListener("online", warmRadioHost);
  document.addEventListener("visibilitychange", () => {
    if (performance.now() - lastWarm > 60000) warmRadioHost();
  });
}
createRoot(document.getElementById("root")!).render(profile ? <App /> : <p>Library not found.</p>);
if (import.meta.env.PROD && "serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(console.warn);
