import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "@sapien/ipc";

type Props = {
  project: Project;
  onContextMenu: (event: MouseEvent) => void;
};

// Мелкая шапка проекта: буква и имя, путь в подсказке. Папки на диске
// больше нет, и шапка говорит об этом.
export function ProjectHeader({ project, onContextMenu }: Props) {
  const { t } = useTranslation("projects");

  return (
    <div title={project.path} className="flex h-6 items-center gap-2 px-2 text-[12px]/4 text-text-faint" onContextMenu={onContextMenu}>
      <span
        aria-hidden
        className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-overlay-pressed text-[10px] font-medium text-text-muted uppercase"
      >
        {project.name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {project.missing && <span className="shrink-0">{t("missing")}</span>}
    </div>
  );
}
