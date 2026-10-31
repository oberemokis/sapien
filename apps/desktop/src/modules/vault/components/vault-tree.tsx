import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileTypeIcon } from "@/core/ui/file-type-icon";
import { Icon } from "@/core/ui/icon";
import { useVaultTree } from "../interactions/vault";
import { noteTitle, type VaultEntry } from "../model/vault";

const ROW = "flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-[13px]";

// Отступ строки от вложенности: ступень 12px, как в дереве MonoCode.
// У заметки нет стрелки, и её место (12px и зазор 6px) уходит в отступ:
// значок заметки встаёт под значок папки того же уровня.
function indent(depth: number, arrow = true) {
  return { paddingLeft: 8 + depth * 12 + (arrow ? 0 : 18) };
}

function Folder({ entry, depth }: { entry: Extract<VaultEntry, { kind: "folder" }>; depth: number }) {
  const [open, setOpen] = useState(false);

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        className={`${ROW} text-content/80 transition-colors duration-120 hover:bg-selection-hover`}
        style={indent(depth)}
        onClick={() => setOpen(!open)}
      >
        <Icon icon={ArrowRight01Icon} size={12} className={`shrink-0 text-content/50 ${open ? "rotate-90" : ""}`} />
        <FileTypeIcon name={entry.name} isFolder isOpen={open} />
        <span className="truncate">{entry.name}</span>
      </button>
      {open && <Entries entries={entry.children} depth={depth + 1} />}
    </li>
  );
}

function Entries({ entries, depth }: { entries: VaultEntry[]; depth: number }) {
  return (
    <ul>
      {entries.map((entry) =>
        entry.kind === "folder" ? (
          <Folder key={entry.path} entry={entry} depth={depth} />
        ) : (
          // Заметки пока только видны: открывать их будет редактор (#8).
          <li key={entry.path} className={`${ROW} text-content/70`} style={indent(depth, false)}>
            <FileTypeIcon name={entry.name} />
            <span className="truncate">{noteTitle(entry.name)}</span>
          </li>
        ),
      )}
    </ul>
  );
}

// Дерево хранилища в левой панели. Пока хранилище не открыто, панель пуста:
// что делать, объясняет середина окна.
export function VaultTree() {
  const { t } = useTranslation();
  const tree = useVaultTree();

  if (tree.data === undefined) {
    return null;
  }

  if (tree.data.length === 0) {
    return <p className="p-3 text-[13px] text-content/50">{t("files.empty")}</p>;
  }

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto p-1">
      <Entries entries={tree.data} depth={0} />
    </nav>
  );
}
