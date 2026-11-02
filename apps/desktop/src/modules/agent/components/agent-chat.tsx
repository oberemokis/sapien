// Список действий после «/» это combobox по ARIA, как поиск сессии: фокус
// остаётся в поле, строку выбирают стрелками через aria-activedescendant,
// мышь только дублирует их. Родной datalist не показывает клавишу действия
// и пометку «нет сети».
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events */
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import type { MenuItem } from "@/core/ui/context-menu";
import { Icon } from "@/core/ui/icon";
import { MenuButton } from "@/core/ui/menu-button";
import { useActionList, useRunAction } from "../interactions/actions";
import { draftOf, useChat, useOnline, writeDraft } from "../interactions/chat";
import { useClaudeStatus } from "../interactions/claude";
import { setAgentModel, useAgentModel } from "../interactions/model";
import { hotkeyLabel, type Action } from "../model/actions";
import {
  AGENT_MODELS,
  isToolName,
  MODEL_NAMES,
  problemOf,
  resetsAt,
  type Answer,
  type ChatEntry,
  type NoticeEntry,
  type PermissionEntry,
  type QuestionEntry,
} from "../model/chat";
import type { Project, SessionInfo } from "../model/sessions";

type Props = {
  session: SessionInfo;
  // Папка сессии. undefined: проект убрали, пока сессия была открыта.
  project: Project | undefined;
};

const OPTION =
  "flex h-7 cursor-default items-center gap-2 rounded-sm pr-1.5 pl-3 text-[13px] aria-disabled:opacity-50 aria-selected:bg-overlay-pressed";

// Действие внутри строки, как link-action дизайн-системы.
const LINK =
  "shrink-0 text-[13px] font-medium underline decoration-text-base/40 underline-offset-2 hover:decoration-text-base";

const BUBBLE =
  "max-w-[82%] self-end rounded-xl bg-bg-layer-02 px-3 py-2 text-[14px]/[21px] font-[400] break-words whitespace-pre-wrap";

// Квадратные кнопки под полем ввода: «+», отправка и «Стоп».
const SQUARE =
  "grid size-7 shrink-0 place-items-center rounded-md transition-colors duration-120 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus";

const SEND = `${SQUARE} bg-bg-submit text-text-submit shadow-button-contrast enabled:hover:bg-[image:linear-gradient(rgb(0_0_0/0.08),rgb(0_0_0/0.08))] disabled:opacity-40`;

// Рамка вопроса и разрешения: карточка над лентой, как доки opencode.
const DOCK = "flex flex-col gap-3 bg-bg-dock p-3 shadow-raised";

function Line({ entry }: { entry: Exclude<ChatEntry, QuestionEntry | PermissionEntry | NoticeEntry> }) {
  const { t } = useTranslation();

  if (entry.kind === "user") {
    return <p className={BUBBLE}>{entry.text}</p>;
  }

  // ponytail: ответ показан исходным markdown, без разметки. Рисовать его
  // разметкой, когда понадобится.
  if (entry.kind === "assistant") {
    return <p className="text-[14px]/[22.4px] font-[400] break-words whitespace-pre-wrap">{entry.text}</p>;
  }

  // Встроенный инструмент подписан по-русски, чужой своим именем.
  let action: string = entry.name;

  if (isToolName(entry.name)) {
    action = t(`agent.tools.${entry.name}`);
  }

  if (!entry.ok) {
    action = t("agent.chat.toolFailed", { action });
  }

  return (
    <p className="flex h-7 min-w-0 items-center gap-1.5 text-[13px]/4" title={entry.target}>
      <span className={`shrink-0 font-medium ${entry.ok ? "" : "text-state-fg-danger"}`}>{action}</span>
      <span className="truncate text-text-muted">{entry.target}</span>
    </p>
  );
}

type AskedProps = {
  entry: QuestionEntry | PermissionEntry;
  // Ждёт ли строка ответа человека сейчас.
  waiting: boolean;
  answer: (id: string, answer: Answer) => void;
};

// Вопрос агента с вариантами или просьба разрешить инструмент. Пока строка
// ждёт, под ней кнопки, а свой ответ пишут в поле ввода. Ответ на вопрос
// остаётся в ленте репликой человека.
function Asked({ entry, waiting, answer }: AskedProps) {
  const { t } = useTranslation();

  if (entry.kind === "permission") {
    return (
      <div role="group" aria-label={t("agent.chat.permissionLabel")} className={`${DOCK} rounded-dock`}>
        <div className="flex items-start gap-2 text-[14px]/[21px] font-[500] break-words">
          <Icon icon="shield" size={16} className="mt-0.5 shrink-0 text-state-fg-warning" />
          <p className="min-w-0">
            {t("agent.chat.permission", { tool: entry.tool })}
            {entry.target !== "" && (
              <span className="mt-1 block font-mono text-[12px]/[18px] font-normal break-all whitespace-pre-wrap text-text-muted">
                {entry.target}
              </span>
            )}
          </p>
        </div>
        {waiting && (
          <div className="flex justify-end gap-2">
            <Button onClick={() => answer(entry.id, { kind: "deny" })}>{t("agent.chat.deny")}</Button>
            <Button variant="submit" onClick={() => answer(entry.id, { kind: "allow" })}>
              {t("agent.chat.allow")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div role="group" aria-label={t("agent.chat.questionLabel")} className="flex flex-col gap-2">
      <div className={`${DOCK} rounded-xl`}>
        <p className="text-[13px]/5 font-medium break-words whitespace-pre-wrap">{entry.question}</p>
        {waiting && (
          <div className="flex flex-col gap-1.5">
            {entry.options.map((option) => (
              <button
                key={option}
                type="button"
                className="w-full rounded-md bg-bg-layer-01 p-2.5 text-left text-[13px]/5 shadow-[inset_0_0_0_0.5px_var(--border-border-base)] outline-none transition-colors duration-120 hover:bg-bg-layer-02 focus-visible:shadow-[inset_0_0_0_1px_var(--border-border-focus)]"
                onClick={() => answer(entry.id, { kind: "text", text: option })}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
      {!waiting && entry.answer !== null && <p className={BUBBLE}>{entry.answer}</p>}
      {!waiting && entry.answer === null && (
        <p className="text-[13px]/4 text-text-faint">{t("agent.chat.noAnswer")}</p>
      )}
    </div>
  );
}

// Отметка в истории. Отказ виден причиной, у лимита подписки со временем
// сброса, а у последнего «Повторить». Новый разговор Claude Code это
// просто строка.
function Noticed({ entry, retry }: { entry: NoticeEntry; retry: (() => void) | null }) {
  const { t } = useTranslation();

  if (entry.code === "claude_session_new") {
    return <p className="text-[13px]/4 text-text-faint">{t("agent.chat.sessionNew")}</p>;
  }

  let reason: string = t(`agent.problems.${problemOf(entry.code)}`);

  if (entry.resets !== null) {
    reason = `${reason} ${t("agent.chat.resets", resetsAt(entry.resets))}`;
  }

  // Отказ хода строкой ленты, а не плашкой: значок даёт цвет, текст остаётся
  // читаемым.
  return (
    <div className="flex items-start gap-2 text-[13px]/5">
      <Icon icon="warning" size={16} className="mt-0.5 shrink-0 text-state-fg-danger" />
      <p className="flex-1">
        <span>{reason}</span>
        {retry !== null && (
          <>
            {" "}
            <button type="button" className={LINK} onClick={retry}>
              {t("agent.chat.retry")}
            </button>
          </>
        )}
      </p>
    </div>
  );
}

const TONE = {
  danger: "bg-state-bg-danger shadow-[inset_0_0_0_0.5px_var(--state-border-danger)]",
  warning: "bg-state-bg-warning shadow-[inset_0_0_0_0.5px_var(--state-border-warning)]",
};

// Плашка под лентой, как Banner дизайн-системы: ошибка красная, то, что
// ждёт сети, настройки или другого ответа, жёлтое.
function Notice({
  children,
  action,
  tone = "danger",
}: {
  children: string;
  action?: ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <div role="alert" className={`mx-auto mb-2 flex w-full max-w-200 items-center gap-3 rounded-md px-3 py-2 text-[13px]/5 ${TONE[tone]}`}>
      <p className="flex-1">{children}</p>
      {action}
    </div>
  );
}

// Чат сессии посередине окна. Enter отправляет, Shift+Enter переносит
// строку. Пока идёт ответ, кнопка отправки становится «Стоп». «/» в начале
// поля или «+» открывает список действий: стрелки выбирают, Enter запускает,
// Escape закрывает. Под полем модель и доступ агента к инструментам.
export function AgentChat({ session, project }: Props) {
  const { t } = useTranslation();
  const claude = useClaudeStatus();
  const model = useAgentModel();
  const chat = useChat(session.id);
  const actions = useActionList();
  const runAction = useRunAction();
  const online = useOnline();
  const [draft, keepDraft] = useState(() => draftOf(session.id));
  const [picked, setPicked] = useState(0);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
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

  // Агенту нечем или негде работать: Claude Code не готов или папки
  // проекта больше нет.
  let blocked: ReactNode = null;
  const claudeState = claude.status?.state;

  if (claudeState !== undefined && claudeState !== "ready") {
    blocked = (
      <Notice
        action={
          <Link to="/settings/agent" className={LINK}>
            {t("agent.chat.setUpClaude")}
          </Link>
        }
      >
        {t(`agent.settings.claude.${claudeState}`)}
      </Notice>
    );
  }

  if (project === undefined || project.missing) {
    blocked = <Notice>{t("agent.chat.projectMissing", { path: project?.path ?? "" })}</Notice>;
  }

  // Пока агент ждёт ответа, написанное уходит ответом на его вопрос.
  const answering = chat.open !== null;
  const free = !chat.running && blocked === null;
  const canSend = online && draft.trim() !== "" && (answering || free);
  const canRun = online && free;
  const slash = /^\/[^\n]*$/.test(draft);
  const query = draft.slice(1).trim().toLowerCase();
  let matches: Action[] = [];

  if (slash) {
    matches = actions.filter((action) => action.name.toLowerCase().includes(query));
  }

  const active = Math.min(picked, Math.max(matches.length - 1, 0));

  function setDraft(text: string) {
    keepDraft(text);
    writeDraft(session.id, text);
  }

  function send() {
    if (!canSend) {
      return;
    }

    setDraft("");

    if (chat.open !== null) {
      void chat.answer(chat.open, { kind: "text", text: draft });
      return;
    }

    void chat.send(model, draft);
  }

  function run(action: Action | undefined) {
    if (!canRun || action === undefined) {
      return;
    }

    setDraft("");
    setPicked(0);
    void runAction(action, session.id);
  }

  const models: MenuItem[] = AGENT_MODELS.map((value) => ({
    label: MODEL_NAMES[value],
    checked: value === model,
    onSelect: () => setAgentModel(value),
  }));

  const access: MenuItem[] = [
    {
      label: t("agent.chat.accessAsk"),
      hint: t("agent.chat.accessAskHint"),
      checked: chat.askEdits,
      onSelect: () => chat.setAskEdits(true),
    },
    {
      label: t("agent.chat.accessFull"),
      hint: t("agent.chat.accessFullHint"),
      checked: !chat.askEdits,
      onSelect: () => chat.setAskEdits(false),
    },
  ];

  let noMatch: string | null = null;

  if (slash && actions.length === 0) {
    noMatch = t("agent.actions.none");
  } else if (slash && matches.length === 0) {
    noMatch = t("agent.actions.noMatch");
  }

  // Пустая сессия держит поле ввода посередине окна, первое сообщение
  // уводит его вниз, под ленту.
  const fresh = chat.loaded && chat.entries.length === 0 && !chat.running;

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${fresh ? "justify-center" : ""}`}>
      {!fresh && (
      <div
        ref={logRef}
        role="log"
        aria-label={t("agent.chat.log")}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 pb-3"
      >
        {/* Строки ленты не сжимаются: обрезанная строка инструмента иначе
            уходит в нулевую высоту, когда лента длиннее экрана. */}
        <div className="mx-auto flex w-full max-w-200 flex-1 flex-col gap-3 *:shrink-0">
          {chat.entries.map(({ id, entry }) => {
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

            if (entry.kind === "notice") {
              let retry: (() => void) | null = null;

              if (id === count - 1 && free) {
                retry = () => void chat.send(model, "");
              }

              return <Noticed key={id} entry={entry} retry={retry} />;
            }

            return <Line key={id} entry={entry} />;
          })}
          {chat.running && !answering && last?.kind !== "assistant" && (
            <p className="text-[14px]/5 font-[500] text-text-faint motion-safe:animate-pulse">{t("agent.chat.thinking")}</p>
          )}
        </div>
      </div>
      )}
      <div className="px-4">
        {!online && <Notice tone="warning">{t("agent.chat.offline")}</Notice>}
        {online && blocked}
        {online && chat.problem !== null && (
          <Notice
            action={
              free && (
                <button type="button" className={LINK} onClick={() => void chat.send(model, "")}>
                  {t("agent.chat.retry")}
                </button>
              )
            }
          >
            {t(`agent.problems.${chat.problem}`)}
          </Notice>
        )}
      </div>
      <div className="px-4 pb-4">
        <div className="mx-auto max-w-200 rounded-xl bg-bg-dock shadow-raised">
          {slash && (
            <div className="max-h-48 overflow-y-auto border-b-[0.5px] border-border-base p-0.5">
              {noMatch !== null && <p className="px-3 py-1.5 text-[12px] text-text-muted">{noMatch}</p>}
              <div id={listId} role="listbox" aria-label={t("agent.actions.title")}>
                {matches.map((action, index) => (
                  <div
                    key={action.path}
                    id={`${listId}-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === active}
                    aria-disabled={!canRun}
                    className={OPTION}
                    onMouseMove={() => setPicked(index)}
                    onClick={() => run(action)}
                  >
                    <span className="min-w-0 flex-1 truncate">{action.name}</span>
                    {!online && <span className="text-[12px]">{t("agent.actions.offline")}</span>}
                    {online && action.hotkey !== null && (
                      <kbd className="font-sans text-[11px] text-text-faint">{hotkeyLabel(action.hotkey)}</kbd>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <textarea
            ref={fieldRef}
            role={slash ? "combobox" : undefined}
            aria-label={t("agent.chat.message")}
            aria-expanded={slash ? true : undefined}
            aria-controls={slash ? listId : undefined}
            aria-autocomplete={slash ? "list" : undefined}
            aria-activedescendant={matches.length > 0 ? `${listId}-${active}` : undefined}
            placeholder={answering ? t("agent.chat.answerPlaceholder") : t("agent.chat.placeholder")}
            value={draft}
            rows={3}
            className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[13px]/5 outline-none placeholder:text-text-faint"
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
          {/* Узкому окну обе подписи не влезают: доступ остаётся значком. */}
          <div className="@container flex h-11 items-center gap-0.5 px-2">
            <button
              type="button"
              aria-label={t("agent.actions.title")}
              title={t("agent.actions.title")}
              className={`${SQUARE} text-icon-muted hover:bg-overlay-hover hover:text-icon-base`}
              onClick={() => {
                setDraft("/");
                setPicked(0);
                fieldRef.current?.focus();
              }}
            >
              <Icon icon="plus" size={14} />
            </button>
            <MenuButton
              icon="models"
              label={t("agent.chat.model")}
              value={MODEL_NAMES[model]}
              items={models}
              disabled={chat.running}
            />
            <MenuButton
              icon={chat.askEdits ? "shield" : "warning"}
              tint={chat.askEdits ? undefined : "text-state-fg-warning"}
              label={t("agent.chat.access")}
              value={chat.askEdits ? t("agent.chat.accessAsk") : t("agent.chat.accessFull")}
              items={access}
              shown="hidden @sm:inline"
            />
            <div className="flex-1" />
            {answering && (
              <button
                type="button"
                aria-label={t("agent.chat.answer")}
                title={t("agent.chat.answer")}
                disabled={!canSend}
                className={SEND}
                onClick={send}
              >
                <Icon icon="arrow-up" size={15} />
              </button>
            )}
            {chat.running && (
              <button
                type="button"
                aria-label={t("agent.chat.stop")}
                title={t("agent.chat.stop")}
                className={SEND}
                onClick={() => void chat.stop()}
              >
                <Icon icon="stop" size={14} />
              </button>
            )}
            {!chat.running && (
              <button
                type="button"
                aria-label={t("agent.chat.send")}
                title={t("agent.chat.send")}
                disabled={!canSend}
                className={SEND}
                onClick={send}
              >
                <Icon icon="arrow-up" size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
