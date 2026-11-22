import { profileAt } from "../shared/profiles";

export const profile = profileAt(globalThis.location?.pathname ?? "/");
export const profileLabel = profile === "emma" ? "Emma" : "Nic";

export function apiPath(path: string) {
  if (!profile) throw Error("Unknown library");
  return path === "login" ? "/api/login" : "/api/profiles/" + profile + "/" + path;
}
