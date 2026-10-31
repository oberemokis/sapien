// Список действий после «/» это combobox по ARIA, как поиск файла: фокус
// остаётся в поле, строку выбирают стрелками через aria-activedescendant,
// мышь только дублирует их. Родной datalist не показывает клавишу действия
// и пометку «нет сети».
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events */
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import type { ActionLauncher } from "../interactions/actions";
import { useChat, useOnline, useUndo } from "../interactions/chat";
import { useAgentModel } from "../interactions/model";
import { useModelKey } from "../interactions/model-key";
import { hotkeyLabel, type Action } from "../model/actions";
import {
  isToolName,
  MODEL_NAMES,
  questionsOf,
  type Answer,
  type ChangedEntry,
  type ChatContext,
  type ChatEntry,
  type PermissionEntry,
  type QuestionEntry,
} from "../model/chat";

type Props = {
  // Открытая заметка и выделенное в ней: их даёт страница.
  context: ChatContext;
  // Действия хранилища для «/» в поле ввода.
  actions?: ActionLauncher;
};

const OPTION = "flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-[13px] aria-selected:bg-selection";

const LINK = "shrink-0 text-[13px] font-medium underline-offset-2 hover:underline";

const BUBBLE = "max-w-[85%] self-end rounded-lg bg-selection px-3 py-2 text-[13px] break-words whitespace-pre-wrap";

function Line({ entry }: { entry: Exclude<ChatEntry, ChangedEntry | QuestionEntry | PermissionEntry> }) {
  const { t } = useTranslation();

  if (entry.kind === "user") {
    return <p className={BUBBLE}>{entry.text}</p>;
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

type AskedProps = {
  entry: QuestionEntry | PermissionEntry;
  // Ждёт ли строка ответа человека сейчас.
  waiting: boolean;
  answer: (id: string, answer: Answer) => void;
};

// Вопрос агента с вариантами или просьба разрешить правку. Пока строка ждёт,
// под ней кнопки, а свой ответ пишут в поле ввода. Ответ на вопрос остаётся
// в ленте репликой человека.
function Asked({ entry, waiting, answer }: AskedProps) {
  const { t } = useTranslation();

  if (entry.kind === "permission") {
    let ask: string = t("agent.chat.permission.edit_note", { path: entry.path });

    if (entry.tool === "write_note") {
      ask = t("agent.chat.permission.write_note", { path: entry.path });
    }

    return (
      <div
        role="group"
        aria-label={t("agent.chat.permissionLabel")}
        className="flex flex-col gap-2 rounded-md bg-selection px-3 py-2 text-[13px]"
      >
        <p className="break-words">{ask}</p>
        {waiting && (
          <div className="flex gap-2">
            <Button onClick={() => answer(entry.id, { kind: "allow" })}>{t("agent.chat.allow")}</Button>
            <Button onClick={() => answer(entry.id, { kind: "deny" })}>{t("agent.chat.deny")}</Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div role="group" aria-label={t("agent.chat.questionLabel")} className="flex flex-col gap-2">
      <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">{entry.question}</p>
      {waiting && (
        <div className="flex flex-wrap gap-2">
          {entry.options.map((option) => (
            <Button key={option} onClick={() => answer(entry.id, { kind: "text", text: option })}>
              {option}
            </Button>
          ))}
        </div>
      )}
      {!waiting && entry.answer !== null && <p className={BUBBLE}>{entry.answer}</p>}
      {!waiting && entry.answer === null && <p className="text-[12px] text-content/50">{t("agent.chat.noAnswer")}</p>}
    </div>
  );
}

type ChangedProps = {
  entry: ChangedEntry;
  // Сообщения человека, ответы на которые откатятся вместе с этим.
  later: { turn: number; text: string }[];
  disabled: boolean;
};

// Под ответом, который менял заметки: сколько их и «Откатить». Если вместе
// с ним откатятся более поздние ответы, сначала их список и вопрос.
function Changed({ entry, later, disabled }: ChangedProps) {
  const { t } = useTranslation();
  const undo = useUndo();
  const [asking, setAsking] = useState(false);
  const count = entry.paths.length;

  if (asking) {
    return (
      <div className="flex flex-col gap-2 rounded-md bg-selection px-3 py-2 text-[12px]">
        <p>{t("agent.chat.undoWith")}</p>
        <ul aria-label={t("agent.chat.undoLater")} className="pl-2 text-content/70">
          {later.map((question) => (
            <li key={question.turn} className="truncate">
              {question.text}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setAsking(false);
              undo.mutate(entry.turn);
            }}
          >
            {t("agent.chat.undoAll")}
          </Button>
          <Button onClick={() => setAsking(false)}>{t("agent.chat.undoNo")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[12px] text-content/50">
      <span title={entry.paths.join("\n")}>
        {entry.undone ? t("agent.chat.undone", { count }) : t("agent.chat.changed", { count })}
      </span>
      {!entry.undone && (
        <button
          type="button"
          disabled={disabled || undo.isPending}
          className="font-medium text-content underline-offset-2 hover:underline disabled:opacity-50"
          onClick={() => (entry.with.length > 0 ? setAsking(true) : undo.mutate(entry.turn))}
        >
          {t("agent.chat.undo")}
        </button>
      )}
      {undo.isError && <span role="alert">{t("agent.chat.undoFailed")}</span>}
    </div>
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
// строку. Пока идёт ответ, кнопка отправки становится «Стоп». «/» в начале
// поля открывает список действий: стрелки выбирают, Enter запускает,
// Escape закрывает.
export function AgentChat({ context, actions }: Props) {
  const { t } = useTranslation();
  const key = useModelKey();
  const model = useAgentModel();
  const chat = useChat();
  const online = useOnline();
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState(0);
  const [clearing, setClearing] = useState(false);
  // Что человек убрал из контекста этого сообщения. Другая заметка или
  // другое выделение приходят снова целиком.
  const [dropped, setDropped] = useState({ of: "", path: false, selection: false });
  const logRef = useRef<HTMLDivElement>(null);
  const listId = useId();
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

  const asked = chat.entries.map(({ entry }) => entry);
  // Пока агент ждёт ответа, написанное уходит ответом на его вопрос.
  const answering = chat.open !== null;
  const canSend = online && (!chat.running || answering) && draft.trim() !== "";
  const canRun = online && !chat.running;
  const slash = actions !== undefined && /^\/[^\n]*$/.test(draft);
  const query = draft.slice(1).trim().toLowerCase();
  let matches: Action[] = [];

  if (slash) {
    matches = actions.actions.filter((action) => action.name.toLowerCase().includes(query));
  }

  const active = Math.min(picked, Math.max(matches.length - 1, 0));
  const of = `${context.path}\n${context.selection}`;
  let drop = { of, path: false, selection: false };

  if (dropped.of === of) {
    drop = dropped;
  }

  // Что уйдёт модели вместе с сообщением: открытая заметка и выделение,
  // кроме убранного.
  const sent: ChatContext = {
    path: drop.path ? null : context.path,
    selection: drop.selection ? "" : context.selection,
  };

  function send() {
    if (!canSend) {
      return;
    }

    setDraft("");

    if (chat.open !== null) {
      void chat.answer(chat.open, { kind: "text", text: draft });
      return;
    }

    void chat.send(model, draft, sent);
  }

  function run(action: Action | undefined) {
    if (!canRun || action === undefined || actions === undefined) {
      return;
    }

    setDraft("");
    setPicked(0);
    void actions.run(action, sent);
  }

  const chips: { label: string; title: string; remove: () => void }[] = [];

  if (sent.path !== null) {
    const name = sent.path.split("/").at(-1)?.replace(/\.md$/, "") ?? sent.path;

    chips.push({ label: name, title: sent.path, remove: () => setDropped({ ...drop, path: true }) });
  }

  if (sent.selection.trim() !== "") {
    chips.push({
      label: t("agent.chat.selection"),
      title: sent.selection,
      remove: () => setDropped({ ...drop, selection: true }),
    });
  }

  let header = (
    <>
      <p className="flex-1 truncate text-[12px] text-content/50">{MODEL_NAMES[model]}</p>
      <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-content/60">
        <input
          type="checkbox"
          className="accent-accent"
          checked={chat.askEdits}
          onChange={(event) => chat.setAskEdits(event.target.checked)}
        />
        {t("agent.chat.askEdits")}
      </label>
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

  // Действию не хватило интеграции: вместо повтора ссылка туда, где её
  // подключают.
  let fix = (
    <button type="button" className={LINK} onClick={() => void chat.send(model, "", sent)}>
      {t("agent.chat.retry")}
    </button>
  );

  if (chat.problem === "needsYoutrack") {
    fix = (
      <Link to="/settings/integrations" className={LINK}>
        {t("agent.actions.connect")}
      </Link>
    );
  }

  let noMatch: string | null = null;

  if (slash && actions.actions.length === 0) {
    noMatch = t("agent.actions.none");
  } else if (slash && matches.length === 0) {
    noMatch = t("agent.actions.noMatch");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">{header}</div>
      <div
        ref={logRef}
        role="log"
        aria-label={t("agent.chat.log")}
        // Строки ленты не сжимаются: обрезанная строка инструмента иначе
        // уходит в нулевую высоту, когда лента длиннее панели.
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3 *:shrink-0"
      >
        {chat.loaded && chat.entries.length === 0 && (
          <p className="m-auto text-center text-sm text-content/50">{t("agent.chat.empty")}</p>
        )}
        {chat.entries.map(({ id, entry }) => {
          if (entry.kind === "changed") {
            return <Changed key={id} entry={entry} later={questionsOf(asked, entry.with)} disabled={chat.running} />;
          }

          if (entry.kind === "question" || entry.kind === "permission") {
            return (
              <Asked
                key={id}
                entry={entry}
                waiting={entry.id === chat.open}
                answer={(question, reply) => void chat.answer(question, reply)}
              />
            );
          }

          return <Line key={id} entry={entry} />;
        })}
        {chat.running && !answering && last?.kind !== "assistant" && (
          <p className="text-[12px] text-content/50">{t("agent.chat.thinking")}</p>
        )}
      </div>
      {!online && <Notice>{t("agent.chat.offline")}</Notice>}
      {online && chat.problem !== null && <Notice action={fix}>{t(`agent.problems.${chat.problem}`)}</Notice>}
      {actions !== undefined && actions.deferred.length > 0 && (
        <Notice>{t("agent.actions.deferred", { names: actions.deferred.join(", ") })}</Notice>
      )}
      <div className="p-3 pt-0">
        <div className="rounded-lg border border-stroke focus-within:border-accent">
          {slash && (
            <div className="max-h-48 overflow-y-auto border-b border-hairline p-1">
              {noMatch !== null && <p className="px-2 py-1 text-[12px] text-content/50">{noMatch}</p>}
              <div id={listId} role="listbox" aria-label={t("agent.actions.title")}>
                {matches.map((action, index) => (
                  <div
                    key={action.path}
                    id={`${listId}-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === active}
                    aria-disabled={!canRun}
                    className={`${OPTION} aria-disabled:text-content/40`}
                    onMouseMove={() => setPicked(index)}
                    onClick={() => run(action)}
                  >
                    <span className="min-w-0 flex-1 truncate">{action.name}</span>
                    {!online && <span className="text-[12px]">{t("agent.actions.offline")}</span>}
                    {online && action.hotkey !== null && (
                      <kbd className="font-sans text-[11px] text-content/40">{hotkeyLabel(action.hotkey)}</kbd>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <textarea
            role={slash ? "combobox" : undefined}
            aria-label={t("agent.chat.message")}
            aria-expanded={slash ? true : undefined}
            aria-controls={slash ? listId : undefined}
            aria-autocomplete={slash ? "list" : undefined}
            aria-activedescendant={matches.length > 0 ? `${listId}-${active}` : undefined}
            placeholder={answering ? t("agent.chat.answerPlaceholder") : t("agent.chat.placeholder")}
            value={draft}
            rows={3}
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] outline-none"
            onChange={(event) => {
              setDraft(event.target.value);
              setPicked(0);
            }}
            onKeyDown={(event) => {
              const enter = event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;

              if (slash && event.key === "Escape") {
                event.preventDefault();
                setDraft("");
              } else if (matches.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                setPicked((active + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              } else if (enter && matches.length > 0) {
                event.preventDefault();
                run(matches[active]);
              } else if (enter) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <div className="min-w-0 flex-1">
              {chips.length > 0 && (
                <ul aria-label={t("agent.chat.context")} className="flex flex-wrap gap-1">
                  {chips.map((chip) => (
                    <li
                      key={chip.label}
                      title={chip.title}
                      className="flex h-6 max-w-40 items-center gap-1 rounded-md bg-selection pr-0.5 pl-2 text-[12px] text-content/70"
                    >
                      <span className="truncate">{chip.label}</span>
                      <button
                        type="button"
                        aria-label={t("agent.chat.drop", { what: chip.label })}
                        className="grid size-5 shrink-0 place-items-center rounded text-content/50 transition-colors duration-120 hover:bg-selection-hover hover:text-content"
                        onClick={chip.remove}
                      >
                        <Icon icon={Cancel01Icon} size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {answering && (
              <Button disabled={!canSend} onClick={send}>
                {t("agent.chat.answer")}
              </Button>
            )}
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
