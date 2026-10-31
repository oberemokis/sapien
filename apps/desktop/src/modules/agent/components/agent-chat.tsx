import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import { useChat, useOnline } from "../interactions/chat";
import { useAgentModel } from "../interactions/model";
import { useModelKey } from "../interactions/model-key";
import { isToolName, MODEL_NAMES, type ChatContext, type ChatEntry } from "../model/chat";

type Props = {
  // Открытая заметка и выделенное в ней: их даёт страница.
  context: ChatContext;
};

function Line({ entry }: { entry: ChatEntry }) {
  const { t } = useTranslation();

  if (entry.kind === "user") {
    return (
      <p className="max-w-[85%] self-end rounded-lg bg-selection px-3 py-2 text-[13px] break-words whitespace-pre-wrap">
        {entry.text}
      </p>
    );
  }

  // ponytail: ответ показан исходным markdown, без разметки. Рисовать его
  // разметкой можно редактором заметок только для чтения, когда понадобится.
  if (entry.kind === "assistant") {
    return <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">{entry.text}</p>;
  }

  let action: string = entry.name;

  if (isToolName(entry.name)) {
    action = t(`agent.tools.${entry.name}`);
  }

  if (!entry.ok) {
    action = t("agent.chat.toolFailed", { action });
  }

  return (
    <p className="truncate text-[12px] text-content/50" title={entry.target}>
      {action} <span className="text-content/70">{entry.target}</span>
    </p>
  );
}

// Без ключа поле ввода ни к чему: панель ведёт туда, где ключ задают.
function NoKey() {
  const { t } = useTranslation();

  return (
    <div className="grid flex-1 place-items-center p-4">
      <div className="flex flex-col items-center gap-3 text-center text-content/60">
        <Icon icon={Key01Icon} size={20} />
        <p className="text-sm">{t("agent.chat.noKey")}</p>
        <Link
          to="/settings/agent"
          className="rounded-md border border-stroke px-3 py-1.5 text-[13px] text-content transition-colors duration-120 hover:bg-selection-hover"
        >
          {t("agent.chat.setUp")}
        </Link>
      </div>
    </div>
  );
}

function Notice({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div role="alert" className="mx-3 mb-2 flex items-center gap-3 rounded-md bg-diff-del-bg px-3 py-2 text-[13px]">
      <p className="flex-1">{children}</p>
      {action}
    </div>
  );
}

// Чат с агентом в правой панели. Enter отправляет, Shift+Enter переносит
// строку. Пока идёт ответ, кнопка отправки становится «Стоп».
export function AgentChat({ context }: Props) {
  const { t } = useTranslation();
  const key = useModelKey();
  const model = useAgentModel();
  const chat = useChat();
  const online = useOnline();
  const [draft, setDraft] = useState("");
  const [clearing, setClearing] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const last = chat.entries.at(-1)?.entry;
  const count = chat.entries.length;
  let tail = "";

  if (last?.kind === "assistant") {
    tail = last.text;
  }

  // Новая строка или новый кусок ответа: лента едет вниз за ним. Набор
  // в поле ленту не трогает: человек мог отмотать её назад и читать.
  useEffect(() => {
    const log = logRef.current;

    if (log !== null && count + tail.length > 0) {
      log.scrollTop = log.scrollHeight;
    }
  }, [count, tail]);

  if (key.status === undefined) {
    return <div className="flex-1" />;
  }

  if (key.status.ending === null) {
    return <NoKey />;
  }

  const canSend = online && !chat.running && draft.trim() !== "";

  function send() {
    if (!canSend) {
      return;
    }

    setDraft("");
    void chat.send(model, draft, context);
  }

  let seen = "";

  if (context.path !== null) {
    seen = context.path.split("/").at(-1)?.replace(/\.md$/, "") ?? "";
  }

  if (seen !== "" && context.selection.trim() !== "") {
    seen = t("agent.chat.withSelection", { name: seen });
  }

  let header = (
    <>
      <p className="flex-1 truncate text-[12px] text-content/50">{MODEL_NAMES[model]}</p>
      {chat.entries.length > 0 && !chat.running && (
        <IconButton icon={Delete02Icon} label={t("agent.chat.clear")} onClick={() => setClearing(true)} />
      )}
    </>
  );

  if (clearing) {
    header = (
      <>
        <p className="flex-1 truncate text-[12px]">{t("agent.chat.clearAsk")}</p>
        <Button
          onClick={() => {
            setClearing(false);
            void chat.clear();
          }}
        >
          {t("agent.chat.clearYes")}
        </Button>
        <Button onClick={() => setClearing(false)}>{t("agent.chat.clearNo")}</Button>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">{header}</div>
      <div
        ref={logRef}
        role="log"
        aria-label={t("agent.chat.log")}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3"
      >
        {chat.loaded && chat.entries.length === 0 && (
          <p className="m-auto text-center text-sm text-content/50">{t("agent.chat.empty")}</p>
        )}
        {chat.entries.map(({ id, entry }) => (
          <Line key={id} entry={entry} />
        ))}
        {chat.running && last?.kind !== "assistant" && (
          <p className="text-[12px] text-content/50">{t("agent.chat.thinking")}</p>
        )}
      </div>
      {!online && <Notice>{t("agent.chat.offline")}</Notice>}
      {online && chat.problem !== null && (
        <Notice
          action={
            <button
              type="button"
              className="shrink-0 text-[13px] font-medium underline-offset-2 hover:underline"
              onClick={() => void chat.send(model, "", context)}
            >
              {t("agent.chat.retry")}
            </button>
          }
        >
          {t(`agent.problems.${chat.problem}`)}
        </Notice>
      )}
      <div className="p-3 pt-0">
        <div className="rounded-lg border border-stroke focus-within:border-accent">
          <textarea
            aria-label={t("agent.chat.message")}
            placeholder={t("agent.chat.placeholder")}
            value={draft}
            rows={3}
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] outline-none"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <p className="flex-1 truncate pl-1 text-[12px] text-content/50" title={context.path ?? undefined}>
              {seen}
            </p>
            {chat.running && <Button onClick={() => void chat.stop()}>{t("agent.chat.stop")}</Button>}
            {!chat.running && (
              <Button disabled={!canSend} onClick={send}>
                {t("agent.chat.send")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
