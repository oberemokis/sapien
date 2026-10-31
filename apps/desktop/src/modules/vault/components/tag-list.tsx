import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import { useId, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu } from "@/core/ui/context-menu";
import { Icon } from "@/core/ui/icon";
import { showTag } from "../interactions/search";
import { setTagPanel, useTagPanel } from "../interactions/tag-panel";
import { useTagList } from "../interactions/tags";
import { useVaultStatus } from "../interactions/vault";

// Раздел «Теги» под деревом, как панель тегов Obsidian: все теги хранилища
// с числом заметок. Клик показывает заметки с тегом в окне поиска.
// Тегов много: раздел прокручивается сам и дерево не вытесняет. Заголовок
// сворачивает раздел, а из его меню раздел убирается совсем: вернуть его
// можно в настройках «Внешний вид».
export function TagList() {
  const { t } = useTranslation();
  const status = useVaultStatus();
  const tags = useTagList();
  const panel = useTagPanel();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const headingId = useId();
  const listId = useId();

  if (status.data?.kind !== "ready" || panel === "hidden") {
    return null;
  }

  const open = panel === "open";

  function openMenu(event: MouseEvent) {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  }

  return (
    <section
      aria-labelledby={headingId}
      className={`flex shrink-0 flex-col border-t border-hairline ${open ? "max-h-[40%]" : ""}`}
    >
      <h2 id={headingId} className="shrink-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          className="flex h-9 w-full items-center gap-1 pl-3 text-[12px] font-medium text-content/50 transition-colors duration-120 hover:text-content"
          onClick={() => setTagPanel(open ? "collapsed" : "open")}
          onContextMenu={openMenu}
        >
          {t("vault.tags.title")}
          <Icon icon={ArrowRight01Icon} size={12} className={`shrink-0 ${open ? "rotate-90" : ""}`} />
        </button>
      </h2>
      <div id={listId} hidden={!open} className="flex min-h-0 flex-col">
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
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: t("vault.tags.hide"), onSelect: () => setTagPanel("hidden") }]}
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}
