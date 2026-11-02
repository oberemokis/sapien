import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUsage } from "../interactions/claude";
import { untilReset, type Limit } from "../model/usage";

// Порог, с которого полоса лимита желтеет: подписка скоро кончится.
const WARN = 80;

type LimitProps = {
  title: string;
  limit: Limit;
  now: number;
};

// Окно лимита: сколько израсходовано, полоса, сколько осталось и когда сброс.
function LimitCard({ title, limit, now }: LimitProps) {
  const { t } = useTranslation();
  const used = Math.min(100, Math.max(0, Math.round(limit.used)));
  let resets: string | null = null;

  if (limit.resets !== null) {
    const { days, hours, minutes } = untilReset(limit.resets, now);

    if (days > 0) {
      resets = t("agent.usage.inDays", { days, hours });
    } else if (hours > 0) {
      resets = t("agent.usage.inHours", { hours, minutes });
    } else {
      resets = t("agent.usage.inMinutes", { minutes });
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-bg-base p-3 shadow-[inset_0_0_0_0.5px_var(--border-border-muted)]">
      <div className="flex items-baseline justify-between gap-3 text-[13px]/5 text-text-base">
        <span>{title}</span>
        <span className="font-medium">{t("agent.usage.used", { used })}</span>
      </div>
      <progress
        aria-label={title}
        value={used}
        max={100}
        className={`block h-1.5 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-overlay-pressed [&::-webkit-progress-value]:rounded-full ${used >= WARN ? "[&::-webkit-progress-value]:bg-state-fg-warning" : "[&::-webkit-progress-value]:bg-text-muted"}`}
      />
      <div className="flex justify-between gap-3 text-[12px]/4 text-text-muted">
        <span>{t("agent.usage.left", { left: 100 - used })}</span>
        {resets !== null && <span>{t("agent.usage.resets", { after: resets })}</span>}
      </div>
    </div>
  );
}

// «Claude» в нижней полосе окна открывает над собой карточку с лимитами
// подписки за пять часов и за неделю. Закрывается той же кнопкой, Escape
// и нажатием мимо.
export function ClaudeUsage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Время для подписей «обновлено» и «сброс через». Идёт, пока карточка
  // открыта.
  const [now, setNow] = useState(0);
  const { usage, failed, updated, retry } = useUsage(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 30_000);

    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    }

    // Escape, который никто не забрал раньше, закрывает карточку и гасится:
    // тот же нажим не уведёт со страницы настроек. Поэтому слушает document,
    // он получает событие раньше window.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      clearInterval(timer);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Лимиты могут прийти позже нажатия: «сброс через» считается не раньше,
  // чем от их прихода.
  const at = Math.max(now, updated);
  let status: string = t("agent.usage.loading");

  if (usage !== undefined) {
    const ago = Math.floor((at - updated) / 60_000);

    status = ago === 0 ? t("agent.usage.updatedNow") : t("agent.usage.updatedAgo", { minutes: ago });
  } else if (failed) {
    status = t("agent.usage.failed");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        className="flex h-6 items-center rounded-md px-2 text-[12px] text-text-muted transition-colors duration-120 hover:bg-overlay-hover hover:text-text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus aria-expanded:bg-overlay-pressed aria-expanded:text-text-base"
        onClick={() => {
          setNow(Date.now());
          setOpen(!open);
        }}
      >
        {t("agent.usage.button")}
      </button>
      {open && (
        <section
          id={id}
          aria-label={t("agent.usage.title")}
          className="absolute bottom-full left-0 z-30 mb-2 flex w-80 flex-col gap-1 rounded-xl bg-bg-layer-01 p-1 shadow-floating"
        >
          <div className="flex items-start justify-between gap-3 px-3 pt-2 pb-1.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-[13px]/5 font-medium text-text-base">{t("agent.usage.heading")}</h2>
              <p className="text-[12px]/4 text-text-muted">{status}</p>
            </div>
            {failed && usage === undefined && (
              <button type="button" className="shrink-0 text-[12px]/4 text-text-accent hover:text-text-accent-hover" onClick={() => void retry()}>
                {t("agent.usage.retry")}
              </button>
            )}
          </div>
          {usage?.available === false && (
            <p className="px-3 pb-2 text-[12px]/4 text-text-muted">{t("agent.usage.notSubscription")}</p>
          )}
          {usage?.available === true && usage.fiveHour !== null && (
            <LimitCard title={t("agent.usage.fiveHour")} limit={usage.fiveHour} now={at} />
          )}
          {usage?.available === true && usage.sevenDay !== null && (
            <LimitCard title={t("agent.usage.sevenDay")} limit={usage.sevenDay} now={at} />
          )}
        </section>
      )}
    </div>
  );
}
