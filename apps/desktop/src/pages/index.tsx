import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ACTIONS_FOLDER, AgentChat, useActions } from "@/modules/agent";
import { MarkdownEditor } from "@/modules/editor";
import { showPanel, Workspace } from "@/modules/layout";
import { SettingsButton } from "@/modules/settings";
import {
  FileSearch,
  NoteTabs,
  NoteView,
  TagList,
  useActiveNote,
  useFolderNotes,
  VaultGate,
  VaultTree,
} from "@/modules/vault";
import { useYoutrackCheck } from "@/modules/youtrack";

export const Route = createFileRoute("/")({ component: Home });

// Поле имени нового файла и выбор файла живут в дереве: спрятанное дерево
// показывается.
function showFiles() {
  showPanel("files");
}

// Ход действия виден в чате: спрятанный чат показывается.
function showChat() {
  showPanel("chat");
}

function Home() {
  const { t } = useTranslation();
  // Агент видит, что открыто и выделено: хранилище это знает, чат спрашивает.
  // Заметку из папки, закрытой для агента, чат не видит вовсе.
  const active = useActiveNote();
  const note = active.closed ? { path: null, selection: "" } : active;
  // Действия это заметки хранилища, а нужна ли им интеграция, знает её модуль.
  const youtrack = useYoutrackCheck();
  const check = useMemo(() => ({ youtrack }), [youtrack]);
  const actions = useActions({ notes: useFolderNotes(ACTIONS_FOLDER), context: note, check, onRun: showChat });

  // Действие из меню заметки в дереве работает с ней, а не с открытой.
  function noteMenu(path: string) {
    return actions.actions.map((action) => ({
      label: action.name,
      disabled: !actions.online,
      hint: actions.online ? undefined : t("agent.actions.offline"),
      onSelect: () => void actions.run(action, { path, selection: path === note.path ? note.selection : "" }),
    }));
  }

  return (
    <>
      <Workspace
        files={
          <>
            <VaultTree onCreateStart={showFiles} noteMenu={noteMenu} />
            <TagList />
          </>
        }
        title={<NoteTabs onCreateStart={showFiles} />}
        main={
          <VaultGate>
            <NoteView editor={MarkdownEditor} showFiles={showFiles} />
          </VaultGate>
        }
        chat={<AgentChat context={note} actions={actions} />}
        actions={<SettingsButton />}
      />
      <FileSearch />
    </>
  );
}
