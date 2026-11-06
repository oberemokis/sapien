import type { Dictionary } from "@sapien/i18n";
import type { ru } from "./ru";

export const en: Dictionary<typeof ru> = {
  inbox: {
    title: "Inbox",
    empty: "Pull requests, issues and mentions from GitHub and GitLab will show up here. Connect them in settings first.",
    settings: "Open integrations",
  },
  settings: {
    title: "Settings",
    back: "Back",
    sections: "Settings sections",
    groups: {
      app: "App",
      agents: "Agents",
      workspace: "Workspace",
    },
  },
};
