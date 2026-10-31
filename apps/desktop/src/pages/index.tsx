import { createFileRoute } from "@tanstack/react-router";
import { AgentChat } from "@/modules/agent";
import { MarkdownEditor } from "@/modules/editor";
import { showPanel, Workspace } from "@/modules/layout";
import { SettingsButton } from "@/modules/settings";
import { FileSearch, NoteTabs, NoteView, TagList, useActiveNote, VaultGate, VaultTree } from "@/modules/vault";

export const Route = createFileRoute("/")({ component: Home });

// Поле имени нового файла и выбор файла живут в дереве: спрятанное дерево
// показывается.
function showFiles() {
  showPanel("files");
}

function Home() {
  // Агент видит, что открыто и выделено: хранилище это знает, чат спрашивает.
  const note = useActiveNote();

  return (
    <>
      <Workspace
        files={
          <>
            <VaultTree onCreateStart={showFiles} />
            <TagList />
          </>
        }
        title={<NoteTabs onCreateStart={showFiles} />}
        main={
          <VaultGate>
            <NoteView editor={MarkdownEditor} showFiles={showFiles} />
          </VaultGate>
        }
        chat={<AgentChat context={note} />}
        actions={<SettingsButton />}
      />
      <FileSearch />
    </>
  );
}
