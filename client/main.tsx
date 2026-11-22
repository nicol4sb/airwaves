import { createRoot } from "react-dom/client";
import App from "./App";
import { profile, profileLabel } from "./profile";
import "./style.css";
if (profile) {
  document.title = "Airwave · " + profileLabel;
  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = profile === "nic" ? "/manifest.webmanifest" : "/manifest-emma.webmanifest";
  document.head.appendChild(manifest);
}
createRoot(document.getElementById("root")!).render(profile ? <App /> : <p>Library not found.</p>);
if (import.meta.env.PROD && "serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(console.warn);
