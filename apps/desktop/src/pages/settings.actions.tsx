import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ACTIONS_FOLDER, ActionSettings } from "@/modules/agent";
import { openNote, useCreateNote, useFolderNotes } from "@/modules/vault";

export const Route = createFileRoute("/settings/actions")({ component: Actions });

// Действия это заметки хранилища: читает и кладёт их хранилище, «Открыть»
// уводит из настроек в редактор.
function Actions() {
  const notes = useFolderNotes(ACTIONS_FOLDER);
  const create = useCreateNote();
  const navigate = useNavigate();

  return (
    <ActionSettings
      notes={notes}
      create={(name, text) => create.mutateAsync({ folder: ACTIONS_FOLDER, name, text })}
      open={(path) => {
        openNote(path);
        void navigate({ to: "/" });
      }}
    />
  );
}
