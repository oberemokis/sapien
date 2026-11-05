import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { hasModKey, IconButton, shortcutLabel } from "@sapien/ui";
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
};

// Слева дерево файлов, посередине редактор, справа чат. Что в каждой панели,
// решает страница: модуль даёт только места под них.
export function Workspace({ files, main, chat, title }: Props) {
  const { t } = useTranslation("layout");
  const withChat = chat !== undefined;
  const layout = useFittedLayout(withChat);

  useLayoutShortcuts(withChat);

  return (
    <div className="flex h-full flex-col bg-bg-deep">
      <header data-title-bar data-tauri-drag-region="deep" className="flex h-10 shrink-0 select-none items-center">
        <div
          className="flex shrink-0 items-center"
          // Открытое дерево задаёт ширину левой части, и вкладки начинаются
          // над карточкой. Скрытое отдаёт место, и вкладки уходят к кнопкам окна.
          // Кнопки окна не масштабируются вместе со страницей, поэтому место
          // под них делится на масштаб интерфейса.
          style={{
            width: layout.files.visible ? GUTTER + layout.files.width : undefined,
            paddingLeft: windowButtonsVisible ? `calc(${WINDOW_BUTTONS_WIDTH}px / var(--ui-scale, 1))` : GUTTER,
          }}
        >
          <span data-files-peek-trigger className="flex">
            <IconButton
              icon="layout-left"
              label={t(layout.files.visible ? "hideFiles" : "showFiles")}
              shortcut={shortcutLabel("B")}
              onClick={() => togglePanel("files")}
            />
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center px-1.5">{title}</div>
        <div className="flex shrink-0 items-center gap-1 pr-1.5">
          {withChat && (
            <IconButton
              icon="layout-right"
              label={t(layout.chat.visible ? "hideChat" : "showChat")}
              shortcut={shortcutLabel("B", true)}
              onClick={() => togglePanel("chat")}
            />
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 px-2 pb-2">
        {/* Справа у панели тот же отступ, что слева у края окна: строки
            не прилипают к карточке. Отступ внутри ширины панели, поэтому
            расчёт раскладки его не видит. */}
        {layout.files.visible && (
          <aside className="relative flex shrink-0 flex-col pr-2" style={{ width: layout.files.width }}>
            {files}
            <ResizeHandle
              panel="files"
              edge="right"
              width={layout.files.width}
              min={FILES_PANEL.min}
              max={FILES_PANEL.max}
              label={t("resizeFiles")}
            />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-xl bg-bg-base shadow-raised">
          <main className="flex min-w-0 flex-1 flex-col">{main}</main>
          {layout.chat.visible && (
            <aside
              className="relative flex shrink-0 flex-col border-l-[0.5px] border-border-base"
              style={{ width: layout.chat.width }}
            >
              <ResizeHandle
                panel="chat"
                edge="left"
                width={layout.chat.width}
                min={CHAT_PANEL.min}
                max={CHAT_PANEL.max}
                label={t("resizeChat")}
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
