import { useTranslation } from "react-i18next";
import type { Project } from "@sapien/ipc";
import { Button } from "@sapien/ui";
import { useRemoveProject } from "../interactions/projects";

type Props = {
  project: Project;
  // Проект ушёл вместе с сессиями: их список перечитывает тот, кто их
  // показывает.
  onRemoved: () => Promise<unknown>;
  onClose: () => void;
};

// Вопрос перед тем, как убрать проект. Отказ Rust, например при ответе
// агента в проекте, остаётся под вопросом.
export function RemoveProject({ project, onRemoved, onClose }: Props) {
  const { t } = useTranslation("projects");
  const remove = useRemoveProject(onRemoved);

  return (
    <div role="alert" className="mx-1 my-1 flex flex-col gap-2 rounded-md bg-bg-layer-01 p-2 text-[13px]/5 shadow-[inset_0_0_0_0.5px_var(--border-border-muted)]">
      <p>{t("removeAsk")}</p>
      <div className="flex gap-2">
        <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(project.id, { onSuccess: onClose })}>
          {t("removeYes")}
        </Button>
        <Button onClick={onClose}>{t("removeNo")}</Button>
      </div>
      {remove.isError && <p className="text-state-fg-danger">{t("removeFailed")}</p>}
    </div>
  );
}
