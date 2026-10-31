import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import ArrowDataTransferHorizontalIcon from "@hugeicons/core-free-icons/ArrowDataTransferHorizontalIcon";
import AtIcon from "@hugeicons/core-free-icons/AtIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import Comment01Icon from "@hugeicons/core-free-icons/Comment01Icon";
import FilterIcon from "@hugeicons/core-free-icons/FilterIcon";
import InboxIcon from "@hugeicons/core-free-icons/InboxIcon";
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
import SquareUnlock02Icon from "@hugeicons/core-free-icons/SquareUnlock02Icon";
import TickDouble02Icon from "@hugeicons/core-free-icons/TickDouble02Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import type { IconSvgElement } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openLink } from "@/core/links/open-link";
import { Icon } from "@/core/ui/icon";
import { IconButton } from "@/core/ui/icon-button";
import { markRead, useIssueDetail, type InboxState } from "../interactions/inbox";
import { ago, filterEvents } from "../model/inbox";
import { youtrackProblemOf, type FeedEvent } from "../model/youtrack";

const KIND_ICONS: Record<FeedEvent["kind"], IconSvgElement> = {
  state: ArrowDataTransferHorizontalIcon,
  comment: Comment01Icon,
  assigned: UserAdd01Icon,
  mentioned: AtIcon,
  unblocked: SquareUnlock02Icon,
  due_soon: Clock01Icon,
  overdue: Alert02Icon,
};

const ACTION =
  "flex items-center gap-1.5 rounded-md border border-stroke px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors duration-120 hover:bg-selection-hover disabled:opacity-50";

function useAgo() {
  const { i18n } = useTranslation();
  const format = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });

  return (at: number) => {
    const { value, unit } = ago(at, Date.now());

    return format.format(value, unit);
  };
}

// Что случилось, одной строкой: текст комментария, «было → стало»,
// закрывшаяся блокирующая задача.
function detailOf(t: TFunction, event: FeedEvent) {
  let detail = event.detail;

  if (event.kind === "unblocked" && detail !== null) {
    detail = t("youtrack.inbox.unblockedBy", { id: detail });
  }

  if (event.author !== null && detail !== null) {
    return `${event.author}: ${detail}`;
  }

  return detail ?? event.author;
}

function EventRow({ event, unread, selected, onSelect }: { event: FeedEvent; unread: boolean; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const since = useAgo();
  const detail = detailOf(t, event);

  return (
    <li>
      <button
        type="button"
        aria-current={selected || undefined}
        className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors duration-120 hover:bg-selection-hover aria-current:bg-selection"
        onClick={onSelect}
      >
        <span className="flex w-full items-center gap-1.5 text-[12px] text-content/50">
          <Icon icon={KIND_ICONS[event.kind]} size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t(`youtrack.inbox.kinds.${event.kind}`)} · {event.project}
          </span>
          <span className="shrink-0">{since(event.at)}</span>
          {unread && (
            <>
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
              <span className="sr-only">{t("youtrack.inbox.new")}</span>
            </>
          )}
        </span>
        <span className="w-full truncate text-[13px] font-medium">
          {event.issue} {event.summary}
        </span>
        {detail !== null && <span className="w-full truncate text-[12px] text-content/50">{detail}</span>}
      </button>
    </li>
  );
}

function IssuePane({ event, online, onAsk }: { event: FeedEvent; online: boolean; onAsk: (prompt: string) => void }) {
  const { t, i18n } = useTranslation();
  const issue = useIssueDetail(event.issue, online);
  const detail = detailOf(t, event);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  let body = null;

  if (issue.data !== undefined) {
    body = (
      <>
        <p className="text-[13px] whitespace-pre-wrap">{issue.data.description || t("youtrack.inbox.noDescription")}</p>
        <h3 className="mt-6 mb-2 text-[13px] font-medium text-content/60">{t("youtrack.inbox.comments")}</h3>
        {issue.data.comments.length === 0 && <p className="text-[13px] text-content/50">{t("youtrack.inbox.noComments")}</p>}
        <ul className="flex flex-col gap-3">
          {issue.data.comments.map((comment) => (
            <li key={`${comment.created}-${comment.author}`} className="rounded-md border border-stroke px-3 py-2">
              <p className="mb-1 text-[12px] text-content/50">
                {comment.author ?? "?"} · {date.format(comment.created)}
              </p>
              <p className="text-[13px] whitespace-pre-wrap">{comment.text}</p>
            </li>
          ))}
        </ul>
      </>
    );
  } else if (issue.error !== null) {
    body = (
      <p role="alert" className="text-[13px] text-diff-del-fg">
        {t("youtrack.inbox.detailFailed", { problem: t(`youtrack.problems.${youtrackProblemOf(issue.error)}`) })}
      </p>
    );
  } else if (!online) {
    body = <p className="text-[13px] text-content/50">{t("youtrack.inbox.detailOffline")}</p>;
  }

  const meta = [issue.data?.state, issue.data?.reporter && t("youtrack.inbox.reporter", { name: issue.data.reporter })];

  return (
    <article className="mx-auto w-full max-w-3xl px-8 py-6">
      <p className="flex items-center gap-1.5 text-[13px] text-content/50">
        <Icon icon={KIND_ICONS[event.kind]} size={14} />
        {t(`youtrack.inbox.kinds.${event.kind}`)} · {event.issue} · {event.project}
      </p>
      <h2 className="mt-2 text-[20px] font-semibold">{event.summary}</h2>
      <p className="mt-1 text-[13px] text-content/50">{meta.filter(Boolean).join(" · ")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={ACTION}
          onClick={() => onAsk(t("youtrack.inbox.askPrompt", { id: event.issue, summary: event.summary }))}
        >
          <Icon icon={AiChat02Icon} size={14} />
          {t("youtrack.inbox.ask")}
        </button>
        <button
          type="button"
          disabled={issue.data === undefined}
          className={ACTION}
          onClick={() => issue.data !== undefined && openLink(issue.data.url)}
        >
          <Icon icon={LinkSquare02Icon} size={14} />
          {t("youtrack.inbox.open")}
        </button>
      </div>
      {detail !== null && (
        <blockquote className="mt-6 rounded-md bg-selection-subtle px-3 py-2 text-[13px] whitespace-pre-wrap">{detail}</blockquote>
      )}
      <div className="mt-6 border-t border-hairline pt-6">{body}</div>
    </article>
  );
}

// Шапка ленты: что с подключением и когда лента обновлялась.
function Status({ inbox }: { inbox: InboxState }) {
  const { t } = useTranslation();
  const since = useAgo();
  let updated: string = t("youtrack.inbox.never");

  if (inbox.polled !== null) {
    updated = t("youtrack.inbox.updated", { time: since(inbox.polled) });
  }

  let problem = null;

  if (!inbox.connected) {
    problem = t("youtrack.inbox.none");
  } else if (inbox.problem !== null) {
    problem = t(`youtrack.problems.${inbox.problem}`);
  }

  return (
    <div className="flex flex-col gap-1 px-3 pb-2 text-[12px] text-content/50">
      {problem !== null && (
        <div role="alert" className="flex flex-col items-start gap-1 rounded-md bg-diff-del-bg px-2.5 py-2 text-content">
          <span>{problem}</span>
          <Link to="/settings/integrations" className="font-medium underline-offset-2 hover:underline">
            {t("youtrack.inbox.settings")}
          </Link>
        </div>
      )}
      {!inbox.online && <span>{t("youtrack.inbox.offline")}</span>}
      <span>{updated}</span>
    </div>
  );
}

type Props = {
  inbox: InboxState;
  // Вопрос агенту о задаче: страница показывает чат и спрашивает.
  onAsk: (prompt: string) => void;
};

// «Входящие», как Inbox в MonoCode: слева события по отслеживаемым задачам,
// справа задача выбранного события. Открытое событие прочитано. Лента
// только читает: ответить можно в YouTrack или через агента.
export function Inbox({ inbox, onAsk }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const events = filterEvents(inbox.events, filter);
  const read = new Set(inbox.read);
  const selected = inbox.events.find((event) => event.id === selectedId);
  let empty = null;

  if (inbox.events.length === 0 && inbox.refreshing) {
    empty = t("youtrack.inbox.loading");
  } else if (inbox.events.length === 0) {
    empty = t("youtrack.inbox.empty");
  } else if (events.length === 0) {
    empty = t("youtrack.inbox.nothing");
  }

  function select(event: FeedEvent) {
    setSelectedId(event.id);
    markRead([event.id]);
  }

  return (
    <div className="flex h-full min-h-0">
      <section aria-label={t("youtrack.inbox.title")} className="flex w-[280px] shrink-0 flex-col border-r border-hairline">
        <div className="flex h-11 shrink-0 items-center gap-1 px-2">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-stroke px-2 text-content/50">
            <Icon icon={FilterIcon} size={13} className="shrink-0" />
            <input
              aria-label={t("youtrack.inbox.filter")}
              placeholder={t("youtrack.inbox.filter")}
              value={filter}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none"
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <IconButton
            icon={TickDouble02Icon}
            label={t("youtrack.inbox.readAll")}
            onClick={() => markRead(inbox.events.map((event) => event.id))}
          />
          <IconButton icon={RefreshIcon} label={t("youtrack.inbox.refresh")} onClick={inbox.refresh} />
        </div>
        <Status inbox={inbox} />
        {empty !== null && <p className="px-3 py-2 text-[13px] text-content/50">{empty}</p>}
        <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              unread={!read.has(event.id)}
              selected={event.id === selectedId}
              onSelect={() => select(event)}
            />
          ))}
        </ul>
      </section>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {selected === undefined ? (
          <div className="grid h-full place-items-center text-[13px] text-content/50">
            <span className="flex flex-col items-center gap-2">
              <Icon icon={InboxIcon} size={28} />
              {t("youtrack.inbox.pick")}
            </span>
          </div>
        ) : (
          <IssuePane key={selected.id} event={selected} online={inbox.online} onAsk={onAsk} />
        )}
      </div>
    </div>
  );
}

// Пункт «Входящие» в боковой панели. Синяя точка: есть непрочитанное.
export function InboxLink({ inbox, active, onOpen }: { inbox: InboxState; active: boolean; onOpen: () => void }) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      aria-current={active || undefined}
      className="mx-1.5 mt-1 flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] text-content/80 transition-colors duration-120 hover:bg-selection-hover aria-current:bg-selection aria-current:text-content"
      onClick={onOpen}
    >
      <Icon icon={InboxIcon} size={15} className="shrink-0" />
      <span className="flex-1 text-left">{t("youtrack.inbox.title")}</span>
      {inbox.unread > 0 && (
        <>
          <span aria-hidden className="size-2 rounded-full bg-accent" />
          <span className="sr-only">{t("youtrack.inbox.unread", { count: inbox.unread })}</span>
        </>
      )}
    </button>
  );
}
