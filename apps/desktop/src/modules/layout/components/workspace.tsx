import PanelLeftIcon from "@hugeicons/core-free-icons/PanelLeftIcon";
import PanelRightIcon from "@hugeicons/core-free-icons/PanelRightIcon";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/core/ui/icon-button";
import { hasModKey, shortcutLabel } from "@/core/ui/keys";
import {
  togglePanel,
  useFittedLayout,
  windowButtonsVisible,
} from "../interactions/layout";
import {
  CHAT_PANEL,
  FILES_PANEL,
  GUTTER,
  WINDOW_BUTTONS_WIDTH,
} from "../model/layout";
import { FilesPeek } from "./files-peek";
import { ResizeHandle } from "./resize-handle";

// ⌘B прячет дерево, ⇧⌘B чат, как в MonoCode. Редактор, которому ⌘B нужен
// под жирный, гасит событие у себя, и раскладка его не трогает.
function useLayoutShortcuts(withChat: boolean) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Код клавиши, а не символ: в русской раскладке та же клавиша печатает «и».
      if (event.defaultPrevented || event.code !== "KeyB" || event.altKey || !hasModKey(event)) {
        return;
      }

      if (event.shiftKey && !withChat) {
        return;
      }

      event.preventDefault();
      togglePanel(event.shiftKey ? "chat" : "files");
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [withChat]);
}

type Props = {
  files: ReactNode;
  main: ReactNode;
  // Экран без чата, например настройки, отдаёт его место середине.
  chat?: ReactNode;
  // Середина верхней полосы: вкладки или путь по экрану.
  title?: ReactNode;
  // Кнопки у правого края верхней полосы.
  actions?: ReactNode;
};

// Слева дерево файлов, посередине редактор, справа чат. Что в каждой панели,
// решает страница: модуль даёт только места под них.
export function Workspace({ files, main, chat, title, actions }: Props) {
  const { t } = useTranslation();
  const withChat = chat !== undefined;
  const layout = useFittedLayout(withChat);

  useLayoutShortcuts(withChat);

  return (
    <div className="flex h-full flex-col bg-shell">
      <header data-title-bar data-tauri-drag-region="deep" className="flex h-10 shrink-0 select-none items-center">
        <div
          className="flex shrink-0 items-center"
          // Открытое дерево задаёт ширину левой части, и вкладки начинаются
          // над карточкой. Скрытое отдаёт место, и вкладки уходят к кнопкам окна.
          style={{
            width: layout.files.visible ? GUTTER + layout.files.width : undefined,
            paddingLeft: windowButtonsVisible ? WINDOW_BUTTONS_WIDTH : GUTTER,
          }}
        >
          <span data-files-peek-trigger className="flex">
            <IconButton
              icon={PanelLeftIcon}
              label={t(layout.files.visible ? "layout.hideFiles" : "layout.showFiles")}
              shortcut={shortcutLabel("B")}
              onClick={() => togglePanel("files")}
            />
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center px-1.5">{title}</div>
        <div className="flex shrink-0 items-center gap-0.5 pr-1.5">
          {actions}
          {withChat && (
            <IconButton
              icon={PanelRightIcon}
              label={t(layout.chat.visible ? "layout.hideChat" : "layout.showChat")}
              shortcut={shortcutLabel("B", true)}
              onClick={() => togglePanel("chat")}
            />
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 px-1.5 pb-1.5">
        {layout.files.visible && (
          <aside className="relative flex shrink-0 flex-col" style={{ width: layout.files.width }}>
            {files}
            <ResizeHandle
              panel="files"
              edge="right"
              width={layout.files.width}
              min={FILES_PANEL.min}
              max={FILES_PANEL.max}
              label={t("layout.resizeFiles")}
            />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-[10px] border border-stroke bg-card">
          <main className="flex min-w-0 flex-1 flex-col">{main}</main>
          {layout.chat.visible && (
            <aside
              className="relative flex shrink-0 flex-col border-l border-stroke"
              style={{ width: layout.chat.width }}
            >
              <ResizeHandle
                panel="chat"
                edge="left"
                width={layout.chat.width}
                min={CHAT_PANEL.min}
                max={CHAT_PANEL.max}
                label={t("layout.resizeChat")}
              />
              {chat}
            </aside>
          )}
        </div>
      </div>
      {!layout.files.visible && <FilesPeek width={layout.files.width}>{files}</FilesPeek>}
    </div>
  );
}
