export const profileNames = ["nic", "emma"] as const;
export type ProfileName = (typeof profileNames)[number];

export function profileAt(path: string): ProfileName | undefined {
  if (path === "/" || path === "/index.html") return "nic";
  return profileNames.find((name) => path === "/" + name || path === "/" + name + "/");
}
