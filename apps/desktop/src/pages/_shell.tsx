import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Workspace } from "@sapien/layout";
import { Icon } from "@sapien/ui";

export const Route = createFileRoute("/_shell")({ component: Shell });

// Главный экран: слева разделы, посередине выбранный. Разделы придут
// с интеграциями, пока раздел один.
function Shell() {
  const { t } = useTranslation();

  return (
    <Workspace
      files={
        <nav className="flex flex-col gap-0.5 px-1 pt-2">
          <Link
            to="/inbox"
            className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px]/4 text-text-muted outline-none transition-colors duration-120 hover:bg-overlay-hover hover:text-text-base focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus [&_svg]:text-icon-muted aria-[current=page]:bg-overlay-pressed aria-[current=page]:text-text-base aria-[current=page]:[&_svg]:text-icon-base"
          >
            <Icon icon="archive" />
            {t("inbox.title")}
          </Link>
        </nav>
      }
      main={<Outlet />}
    />
  );
}
