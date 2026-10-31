import { useId } from "react";
import { useTranslation } from "react-i18next";
import { showTag } from "../interactions/search";
import { useTagList } from "../interactions/tags";
import { useVaultStatus } from "../interactions/vault";

// Раздел «Теги» под деревом, как панель тегов Obsidian: все теги хранилища
// с числом заметок. Клик показывает заметки с тегом в окне поиска.
// Тегов много: раздел прокручивается сам и дерево не вытесняет.
export function TagList() {
  const { t } = useTranslation();
  const status = useVaultStatus();
  const tags = useTagList();
  const headingId = useId();

  if (status.data?.kind !== "ready") {
    return null;
  }

  return (
    <section aria-labelledby={headingId} className="flex max-h-[40%] shrink-0 flex-col border-t border-hairline">
      <h2 id={headingId} className="flex h-9 shrink-0 items-center pl-3 text-[12px] font-medium text-content/50">
        {t("vault.tags.title")}
      </h2>
      {tags.length === 0 && <p className="px-3 pb-3 text-[13px] text-content/50">{t("vault.tags.empty")}</p>}
      <ul className="min-h-0 overflow-y-auto p-1 pt-0">
        {tags.map((tag) => (
          <li key={tag.name}>
            <button
              type="button"
              aria-label={t("vault.tags.item", { name: tag.name, count: tag.count })}
              className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-[13px] transition-colors duration-120 hover:bg-selection-hover"
              onClick={() => showTag(tag.name)}
            >
              <span className="text-content/40">#</span>
              <span className="min-w-0 truncate">{tag.name}</span>
              <span className="ml-auto pl-2 text-[12px] text-content/40 tabular-nums">{tag.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
