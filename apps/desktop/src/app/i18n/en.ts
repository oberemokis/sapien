import type { Dictionary } from "@sapien/i18n";
import type { ru } from "./ru";

export const en: Dictionary<typeof ru> = {
  agent: {
    session: {
      projectMissing:
        "The project folder is no longer on disk: {{path}}. The terminal opens in it, so the session will continue once the folder is back.",
    },
    terminal: {
      exited: "The shell has exited.",
      restart: "Open a new one",
      failed: "The shell did not start.",
      retry: "Retry",
    },
    panes: {
      label: "Pane {{index}}",
      splitRight: "Split right",
      splitLeft: "Split left",
      splitDown: "Split down",
      splitUp: "Split up",
      close: "Close pane",
      last: "The last pane closes with its tab",
      resize: "Pane border",
    },
    sessions: {
      sections: "Sections",
      title: "Sessions",
      new: "New session",
      untitled: "New session",
      running: "agent is working",
      agents: "Agents in “{{title}}”",
      collapse: "Collapse agents in “{{title}}”",
      expand: "Expand agents in “{{title}}”",
      delete: "Delete session",
      rename: "Rename",
      name: "Session name",
      newFailed: "The session was not created.",
      deleteFailed: "The session was not deleted.",
      renameFailed: "The name was not saved.",
    },
    tabs: {
      label: "Tabs of “{{project}}”",
      new: "New session in “{{project}}”",
      close: "Close tab “{{title}}”",
      closeItem: "Close tab",
      rename: "Rename",
      name: "Tab name",
      renameFailed: "The name was not saved.",
      pin: "Pin",
      unpin: "Unpin",
      pinned: "pinned",
    },
    search: {
      open: "Search",
      title: "Search sessions",
      placeholder: "Session or project name",
      recent: "Recent",
      none: "No sessions yet.",
      nothing: "Nothing found",
      keys: {
        open: "open",
        close: "close",
      },
    },
    welcome: {
      firstTitle: "Start with a project folder",
      firstText:
        "The agent works in a folder on disk: it reads and edits its files and runs commands. Each project has its own sessions.",
      title: "No open tabs",
      text: "Open a session on the left or start a new one: it opens as a tab.",
    },
    restoring: "Restoring tabs…",
  },
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
