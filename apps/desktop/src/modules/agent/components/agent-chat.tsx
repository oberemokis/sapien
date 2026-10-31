// Список действий после «/» это combobox по ARIA, как поиск файла: фокус
// остаётся в поле, строку выбирают стрелками через aria-activedescendant,
// мышь только дублирует их. Родной datalist не показывает клавишу действия
// и пометку «нет сети».
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events */
import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import SquareUnlock01Icon from "@hugeicons/core-free-icons/SquareUnlock01Icon";
import StopIcon from "@hugeicons/core-free-icons/StopIcon";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/ui/button";
import type { MenuItem } from "@/core/ui/context-menu";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import { MenuButton } from "@/core/ui/menu-button";
import type { ActionLauncher } from "../interactions/actions";
import { useChat, useOnline, useUndo } from "../interactions/chat";
import { setAgentMethod, useClaudeStatus } from "../interactions/method";
import { setAgentModel, useAgentModel } from "../interactions/model";
import { useModelKey } from "../interactions/model-key";
import { hotkeyLabel, type Action } from "../model/actions";
import {
  AGENT_MODELS,
  isToolName,
  MODEL_NAMES,
  problemOf,
  questionsOf,
  resetsAt,
  type AgentModel,
  type Answer,
  type ChangedEntry,
  type ChatContext,
  type ChatEntry,
  type NoticeEntry,
  type PermissionEntry,
  type QuestionEntry,
} from "../model/chat";
import type { AgentMethod } from "../model/method";

type Props = {
  // Открытая заметка и выделенное в ней: их даёт страница.
  context: ChatContext;
  // Действия хранилища для «/» в поле ввода.
  actions?: ActionLauncher;
};

const OPTION = "flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-[13px] aria-selected:bg-selection";

const LINK = "shrink-0 text-[13px] font-medium underline-offset-2 hover:underline";

const BUBBLE = "max-w-[85%] self-end rounded-lg bg-selection px-3 py-2 text-[13px] break-words whitespace-pre-wrap";

// Квадратные кнопки под полем ввода: «+», отправка и «Стоп».
const SQUARE = "grid size-7 shrink-0 place-items-center rounded-lg transition-colors duration-120";

const SEND = `${SQUARE} bg-content text-background-base disabled:bg-selection disabled:text-content/40`;

function Line({ entry }: { entry: Exclude<ChatEntry, ChangedEntry | QuestionEntry | PermissionEntry | NoticeEntry> }) {
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

// Отметка в истории. Отказ виден причиной, у лимита подписки со временем
// сброса, а у последнего «Повторить». Новый разговор Claude Code это
// просто строка.
function Noticed({ entry, retry }: { entry: NoticeEntry; retry: (() => void) | null }) {
  const { t } = useTranslation();

  if (entry.code === "claude_session_new") {
    return <p className="text-[12px] text-content/50">{t("agent.chat.sessionNew")}</p>;
  }

  let reason: string = t(`agent.problems.${problemOf(entry.code)}`);

  if (entry.resets !== null) {
    reason = `${reason} ${t("agent.chat.resets", resetsAt(entry.resets))}`;
  }

  return (
    <div className="flex items-center gap-3 rounded-md bg-diff-del-bg px-3 py-2 text-[12px]">
      <p className="flex-1">{reason}</p>
      {retry !== null && (
        <button type="button" className={LINK} onClick={retry}>
          {t("agent.chat.retry")}
        </button>
      )}
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
// поля или «+» открывает список действий: стрелки выбирают, Enter запускает,
// Escape закрывает. Под полем модель со способом и доступ агента к правкам.
export function AgentChat({ context, actions }: Props) {
  const { t } = useTranslation();
  const key = useModelKey();
  const claude = useClaudeStatus();
  const model = useAgentModel();
  const chat = useChat();
  const online = useOnline();
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState(0);
  const [clearing, setClearing] = useState(false);
  // Модель другого способа ждёт подтверждения: разговор сменится.
  const [switching, setSwitching] = useState<{ method: AgentMethod; model: AgentModel } | null>(null);
  // Команда для терминала, которую только что скопировали.
  const [copied, setCopied] = useState<{ command: string; ok: boolean } | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
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

  // Скопированная команда видна несколько секунд.
  useEffect(() => {
    if (copied === null) {
      return;
    }

    const timer = setTimeout(() => setCopied(null), 6000);

    return () => clearTimeout(timer);
  }, [copied]);

  // Способу нечем работать: нет ключа или Claude Code не готов. Поле ввода
  // остаётся, чтобы под ним выбрать другой способ.
  let blocked: ReactNode = null;

  if (chat.method === "key" && key.status?.ending === null) {
    blocked = (
      <Notice
        action={
          <Link to="/settings/agent" className={LINK}>
            {t("agent.chat.setUp")}
          </Link>
        }
      >
        {t("agent.chat.noKey")}
      </Notice>
    );
  }

  const claudeState = claude.status?.state;

  if (chat.method === "subscription" && claudeState !== undefined && claudeState !== "ready") {
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

  const asked = chat.entries.map(({ entry }) => entry);
  // Пока агент ждёт ответа, написанное уходит ответом на его вопрос.
  const answering = chat.open !== null;
  const canSend = online && draft.trim() !== "" && (answering || (!chat.running && blocked === null));
  const canRun = online && !chat.running && blocked === null;
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

  // Сессию Claude Code продолжают в терминале обычным claude. Команда
  // пишется в буфер сразу по нажатию, а не вышло, видна, чтобы её
  // скопировали руками.
  function toTerminal(session: string) {
    const command = `claude --resume ${session}`;

    navigator.clipboard.writeText(command).then(
      () => setCopied({ command, ok: true }),
      () => setCopied({ command, ok: false }),
    );
  }

  // Модель своего способа выбирается сразу. Другой способ это другой
  // разговор: при непустой истории сначала вопрос.
  function choose(method: AgentMethod, value: AgentModel) {
    if (method === chat.method || chat.entries.length === 0) {
      setAgentMethod(method);
      setAgentModel(value);
      return;
    }

    setSwitching({ method, model: value });
  }

  // Все модели по способам: подписка Claude, где есть Claude Code, и ключ API.
  const methods: AgentMethod[] = ["key"];

  if (claudeState !== undefined && claudeState !== "unsupported") {
    methods.unshift("subscription");
  }

  const models: MenuItem[] = methods.flatMap((method, group) =>
    AGENT_MODELS.map((value, index) => ({
      id: `${method}/${value}`,
      label: MODEL_NAMES[value],
      heading: index === 0 ? t(`agent.chat.methods.${method}`) : undefined,
      separated: index === 0 && group > 0,
      checked: method === chat.method && value === model,
      onSelect: () => choose(method, value),
    })),
  );

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

  const session = chat.method === "subscription" ? chat.session : null;
  let header = (
    <>
      <p className="flex-1 truncate text-[12px] text-content/50">{t(`agent.chat.methods.${chat.method}`)}</p>
      {session !== null && !chat.running && (
        <IconButton icon={ComputerTerminal01Icon} label={t("agent.chat.terminal")} onClick={() => toTerminal(session)} />
      )}
      {chat.entries.length > 0 && !chat.running && (
        <IconButton icon={Delete02Icon} label={t("agent.chat.clear")} onClick={() => setClearing(true)} />
      )}
    </>
  );

  if (switching !== null) {
    header = (
      <>
        <p className="min-w-0 flex-1 text-[12px] leading-snug">{t("agent.chat.switchAsk")}</p>
        <Button
          onClick={() => {
            setSwitching(null);
            setAgentMethod(switching.method);
            setAgentModel(switching.model);
          }}
        >
          {t("agent.chat.switchYes")}
        </Button>
        <Button onClick={() => setSwitching(null)}>{t("agent.chat.clearNo")}</Button>
      </>
    );
  }

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
      <div className="flex min-h-10 shrink-0 items-center gap-2 px-3 py-1">{header}</div>
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

          if (entry.kind === "notice") {
            let retry: (() => void) | null = null;

            if (id === count - 1 && !chat.running && blocked === null) {
              retry = () => void chat.send(model, "", sent);
            }

            return <Noticed key={id} entry={entry} retry={retry} />;
          }

          return <Line key={id} entry={entry} />;
        })}
        {chat.running && !answering && last?.kind !== "assistant" && (
          <p className="text-[12px] text-content/50">{t("agent.chat.thinking")}</p>
        )}
      </div>
      {!online && <Notice>{t("agent.chat.offline")}</Notice>}
      {online && blocked}
      {online && chat.problem !== null && <Notice action={fix}>{t(`agent.problems.${chat.problem}`)}</Notice>}
      {actions !== undefined && actions.deferred.length > 0 && (
        <Notice>{t("agent.actions.deferred", { names: actions.deferred.join(", ") })}</Notice>
      )}
      {copied !== null && (
        <p role="status" className="mx-3 mb-2 text-[12px] break-all text-content/60">
          {copied.ok
            ? t("agent.chat.copied", { command: copied.command })
            : t("agent.chat.copyFailed", { command: copied.command })}
        </p>
      )}
      <div className="p-3 pt-0">
        <div className="rounded-xl border border-stroke bg-card focus-within:border-content/20">
          {chips.length > 0 && (
            <ul aria-label={t("agent.chat.context")} className="flex flex-wrap gap-1 px-2 pt-2">
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
          {/* Узкой панели обе подписи не влезают: доступ остаётся значком. */}
          <div className="@container flex items-center gap-1.5 px-2 pb-2">
            {actions !== undefined && (
              <button
                type="button"
                aria-label={t("agent.actions.title")}
                title={t("agent.actions.title")}
                className={`${SQUARE} bg-selection text-content/70 hover:bg-selection-hover hover:text-content`}
                onClick={() => {
                  setDraft("/");
                  setPicked(0);
                  fieldRef.current?.focus();
                }}
              >
                <Icon icon={PlusSignIcon} size={14} />
              </button>
            )}
            <MenuButton
              icon={SparklesIcon}
              tint="text-claude"
              label={t("agent.chat.model")}
              value={MODEL_NAMES[model]}
              items={models}
              disabled={chat.running}
            />
            <MenuButton
              icon={chat.askEdits ? Shield01Icon : SquareUnlock01Icon}
              tint="text-caution"
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
                <Icon icon={ArrowUp02Icon} size={15} />
              </button>
            )}
            {chat.running && (
              <button
                type="button"
                aria-label={t("agent.chat.stop")}
                title={t("agent.chat.stop")}
                className={`${SQUARE} bg-content text-background-base`}
                onClick={() => void chat.stop()}
              >
                <Icon icon={StopIcon} size={14} />
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
                <Icon icon={ArrowUp02Icon} size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
