import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "@sapien/ui";

// «Входящие»: пока заглушка. Что сюда выводить из GitHub и GitLab, решим
// вместе с тем, что агент умеет с ними делать.
export function Inbox() {
  const { t } = useTranslation();

  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <Icon icon="archive" size={20} className="text-icon-muted" />
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-[16px]/7 font-medium">{t("inbox.title")}</h1>
          <p className="text-[13px]/5 text-text-muted">{t("inbox.empty")}</p>
        </div>
        <Link
          to="/settings/integrations"
          className="text-[13px] font-medium text-text-accent hover:text-text-accent-hover hover:underline"
        >
          {t("inbox.settings")}
        </Link>
      </div>
    </div>
  );
}
