// Список действий после «/» это combobox по ARIA, как поиск файла: фокус
// остаётся в поле, строку выбирают стрелками через aria-activedescendant,
// мышь только дублирует их. Родной datalist не показывает клавишу действия
// и пометку «нет сети».
/* oxlint-disable jsx-a11y/prefer-tag-over-role, jsx-a11y/click-events-have-key-events */
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
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

function Line({ entry }: { entry: Exclude<ChatEntry, ChangedEntry | QuestionEntry | PermissionEntry | NoticeEntry> }) {
  const { t } = useTranslation();

  if (entry.kind === "user") {
    return <p className={BUBBLE}>{entry.text}</p>;
  }

  // ponytail: ответ показан исходным markdown, без разметки. Рисовать его
  // разметкой можно редактором заметок только для чтения, когда понадобится.
  if (entry.kind === "assistant") {
    return <p className="text-[14px]/[22.4px] font-[400] break-words whitespace-pre-wrap">{entry.text}</p>;
  }

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
      <div role="group" aria-label={t("agent.chat.permissionLabel")} className={`${DOCK} rounded-dock`}>
        <p className="flex items-start gap-2 text-[14px]/[21px] font-[500] break-words">
          <Icon icon={Shield01Icon} size={16} className="mt-0.5 shrink-0 text-state-fg-warning" />
          {ask}
        </p>
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
      <div className="flex flex-col gap-2 rounded-md bg-bg-layer-01 px-3 py-2 text-[13px]/5 shadow-[inset_0_0_0_0.5px_var(--border-border-muted)]">
        <p>{t("agent.chat.undoWith")}</p>
        <ul aria-label={t("agent.chat.undoLater")} className="pl-2 text-text-muted">
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
    <div className="flex items-center gap-2 text-[13px]/5 text-text-muted">
      <span title={entry.paths.join("\n")}>
        {entry.undone ? t("agent.chat.undone", { count }) : t("agent.chat.changed", { count })}
      </span>
      {!entry.undone && (
        <button
          type="button"
          disabled={disabled || undo.isPending}
          className={`${LINK} text-text-base disabled:opacity-50`}
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
      <Icon icon={Alert02Icon} size={16} className="mt-0.5 shrink-0 text-state-fg-danger" />
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
// ждёт сети или настройки, жёлтое.
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
    <div role="alert" className={`mx-3 mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-[13px]/5 ${TONE[tone]}`}>
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
      <p className="flex-1 truncate text-[12px] text-text-muted">{t(`agent.chat.methods.${chat.method}`)}</p>
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
        <p className="min-w-0 flex-1 text-[13px]/4">{t("agent.chat.switchAsk")}</p>
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
        <p className="flex-1 truncate text-[13px]/4">{t("agent.chat.clearAsk")}</p>
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
          <p className="m-auto text-center text-[13px]/5 text-text-muted">{t("agent.chat.empty")}</p>
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
          <p className="text-[14px]/5 font-[500] text-text-faint motion-safe:animate-pulse">{t("agent.chat.thinking")}</p>
        )}
      </div>
      {!online && <Notice tone="warning">{t("agent.chat.offline")}</Notice>}
      {online && blocked}
      {online && chat.problem !== null && <Notice action={fix}>{t(`agent.problems.${chat.problem}`)}</Notice>}
      {actions !== undefined && actions.deferred.length > 0 && (
        <Notice tone="warning">{t("agent.actions.deferred", { names: actions.deferred.join(", ") })}</Notice>
      )}
      {copied !== null && (
        <p role="status" className="mx-3 mb-2 text-[12px] break-all text-text-muted">
          {copied.ok
            ? t("agent.chat.copied", { command: copied.command })
            : t("agent.chat.copyFailed", { command: copied.command })}
        </p>
      )}
      <div className="p-3 pt-0">
        <div className="rounded-xl bg-bg-dock shadow-raised">
          {chips.length > 0 && (
            <ul aria-label={t("agent.chat.context")} className="flex flex-wrap gap-2 px-2 pt-2">
              {chips.map((chip) => (
                <li
                  key={chip.label}
                  title={chip.title}
                  className="flex h-6 max-w-55 items-center gap-1.5 rounded-md bg-overlay-hover pr-0.5 pl-2 text-[13px]/4 text-text-muted shadow-[inset_0_0_0_0.5px_var(--border-border-base)]"
                >
                  <span className="truncate">{chip.label}</span>
                  <button
                    type="button"
                    aria-label={t("agent.chat.drop", { what: chip.label })}
                    className="grid size-5 shrink-0 place-items-center rounded-sm text-icon-muted transition-colors duration-120 hover:bg-overlay-hover hover:text-icon-base focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus"
                    onClick={chip.remove}
                  >
                    <Icon icon={Cancel01Icon} size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
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
          {/* Узкой панели обе подписи не влезают: доступ остаётся значком. */}
          <div className="@container flex h-11 items-center gap-0.5 px-2">
            {actions !== undefined && (
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
                <Icon icon={PlusSignIcon} size={14} />
              </button>
            )}
            <MenuButton
              icon={SparklesIcon}
              label={t("agent.chat.model")}
              value={MODEL_NAMES[model]}
              items={models}
              disabled={chat.running}
            />
            <MenuButton
              icon={chat.askEdits ? Shield01Icon : SquareUnlock01Icon}
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
                <Icon icon={ArrowUp02Icon} size={15} />
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
