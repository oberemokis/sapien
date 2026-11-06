import { useTranslation } from "react-i18next";
import type { Progress } from "@sapien/ipc";
import { Button } from "@sapien/ui";
import { openRelease, useAppVersion, useUpdateInstall, useUpdateOffer } from "../interactions/update";
import { percentOf, releaseItems } from "../model/update";

function ProgressLine({ progress }: { progress: Progress | null }) {
  const { t } = useTranslation("updates");
  const percent = percentOf(progress);
  let label: string = t("offer.downloading");

  if (progress?.kind === "downloaded") {
    label = t("offer.installing");
  } else if (percent !== null) {
    label = t("offer.downloaded", { percent });
  }

  return (
    <div className="flex flex-col gap-2">
      <progress
        aria-label={label}
        value={percent ?? undefined}
        max={100}
        className="h-1 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-bg-layer-02 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-icon-base"
      />
      <p className="text-[12px]/[18px] text-text-muted tabular-nums">{label}</p>
    </div>
  );
}

// Карточка о новой версии в углу окна, поверх любого экрана: что
// изменилось и согласие на установку. Само обновление не ставится.
export function UpdateOffer() {
  const { t } = useTranslation("updates");
  const { update, defer } = useUpdateOffer();
  const current = useAppVersion();
  const { install, installing, progress, problem } = useUpdateInstall();

  if (update === null) {
    return null;
  }

  const items = releaseItems(update.notes);

  return (
    <section
      aria-label={t("offer.label")}
      className="fixed right-4 bottom-4 z-30 flex w-96 flex-col gap-3 rounded-lg bg-bg-layer-01 p-3 text-[13px]/5 text-text-base shadow-floating"
    >
      <header className="flex flex-col">
        <h2 className="font-medium">{t("offer.title", { version: update.version })}</h2>
        {current !== undefined && <p className="text-text-muted">{t("offer.current", { version: current })}</p>}
      </header>

      {items.length > 0 && (
        <ul className="flex max-h-48 list-disc flex-col gap-1 overflow-y-auto pl-[18px] text-text-muted marker:text-text-faint">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="self-start rounded-xs font-medium text-text-accent hover:text-text-accent-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        onClick={() => openRelease(update.version)}
      >
        {t("offer.release")}
      </button>

      {installing && <ProgressLine progress={progress} />}
      {problem !== null && (
        <p role="alert" className="text-state-fg-danger">
          {t(`problems.${problem}`)}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button disabled={installing} onClick={defer}>
          {t("offer.later")}
        </Button>
        <Button variant="submit" disabled={installing} onClick={install}>
          {t("offer.install")}
        </Button>
      </div>
    </section>
  );
}
