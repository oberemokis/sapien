import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useMemo } from "react";
import { useOnline } from "@/core/network/online";
import { readInbox, readTracked, writeInbox, writeTracked } from "../infrastructure/inbox.device";
import { youtrackFeed, youtrackIssueDetail } from "../infrastructure/youtrack.api";
import { DEFAULT_TRACKED, draftIds, FIRST_LOOK, keepRead, mergeEvents, unreadCount, type Inbox } from "../model/inbox";
import { youtrackProblemOf } from "../model/youtrack";
import { inboxStore, trackedStore } from "../store/inbox.store";
import { useYoutrack } from "./connection";

const FEED_KEY = ["youtrack-feed"] as const;
const DETAIL_KEY = ["youtrack-issue-detail"] as const;

// Опрос раз в пять минут, пока окно открыто.
const POLL = 5 * 60_000;

// Опросы перекрываются на минуту: событие, записанное в YouTrack чуть позже
// своего времени, не теряется, а повтор отсекает номер события.
const OVERLAP = 60_000;

export function restoreInbox() {
  inboxStore.setState(() => readInbox());
  trackedStore.setState(() => readTracked());
}

function save(update: (inbox: Inbox) => Inbox) {
  inboxStore.setState(update);
  writeInbox(inboxStore.get());
}

// События с прошлого опроса, а первый раз за неделю. Приложение было
// закрыто: опрос при открытии догоняет всё с момента прошлого.
async function poll(query: string, ids: string[]) {
  const now = Date.now();
  const { polled } = inboxStore.get();
  let since = now - FIRST_LOOK;

  if (polled !== null) {
    since = polled - OVERLAP;
  }

  const fresh = await youtrackFeed(query, ids, since);

  save((inbox) => {
    const events = mergeEvents(inbox.events, fresh);

    return { polled: now, events, read: keepRead(events, inbox.read) };
  });

  return now;
}

export function markRead(ids: string[]) {
  save((inbox) => ({ ...inbox, read: [...new Set([...inbox.read, ...ids])] }));
}

export function useTracked() {
  return useSelector(trackedStore);
}

// Пустой запрос возвращает запрос по умолчанию: иначе лента молча
// опустеет. Ответ это запрос, который теперь действует.
export function changeTracked(query: string) {
  const tracked = query.trim() || DEFAULT_TRACKED;

  trackedStore.setState(() => tracked);
  writeTracked(tracked);

  return tracked;
}

// Лента по отслеживаемым задачам: по запросу из настроек и по номерам
// черновиков из заметок. Опрос живёт на странице целиком, а не в ленте:
// точка у «Входящих» загорается, даже пока лента закрыта. Новые события
// приходят раз в пять минут, когда окно получает фокус и по «Обновить».
export function useInbox(notes: { text: string }[]) {
  const online = useOnline();
  const { status } = useYoutrack();
  const query = useTracked();
  const ids = useMemo(() => draftIds(notes), [notes]);
  const inbox = useSelector(inboxStore);
  const feed = useQuery({
    queryKey: [...FEED_KEY, query, ids],
    queryFn: () => poll(query, ids),
    enabled: online && status?.kind === "connected",
    refetchInterval: POLL,
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const { refetch } = feed;
  const refresh = useCallback(() => void refetch(), [refetch]);
  let problem = null;

  if (status?.kind === "broken") {
    problem = youtrackProblemOf(status.code);
  } else if (feed.error !== null) {
    problem = youtrackProblemOf(feed.error);
  }

  return {
    ...inbox,
    unread: unreadCount(inbox),
    connected: status === undefined || status.kind !== "none",
    online,
    problem,
    refreshing: feed.isFetching,
    refresh,
  };
}

export type InboxState = ReturnType<typeof useInbox>;

// Задача события для правой части ленты. Описание и комментарии меняются
// реже статуса, поэтому ответ живёт минуту.
export function useIssueDetail(id: string | null, online: boolean) {
  return useQuery({
    queryKey: [...DETAIL_KEY, id],
    queryFn: () => youtrackIssueDetail(id ?? ""),
    enabled: id !== null && online,
    staleTime: 60_000,
    retry: false,
  });
}
