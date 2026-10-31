import { useTranslation } from "react-i18next";
import { openLink } from "@/core/links/open-link";
import { Button } from "@/core/ui/button";
import { useAppVersion, useUpdateInstall, useUpdateOffer } from "../interactions/update";
import { percentOf, releaseItems, releaseUrl, type UpdateProgress } from "../model/update";

function ProgressLine({ progress }: { progress: UpdateProgress | null }) {
  const { t } = useTranslation();
  const percent = percentOf(progress);
  let label: string = t("updates.offer.downloading");

  if (progress?.kind === "downloaded") {
    label = t("updates.offer.installing");
  } else if (percent !== null) {
    label = t("updates.offer.downloaded", { percent });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <progress
        aria-label={label}
        value={percent ?? undefined}
        max={100}
        className="h-1 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-stroke [&::-webkit-progress-value]:bg-accent"
      />
      <p className="text-content/50">{label}</p>
    </div>
  );
}

// Карточка о новой версии в углу окна, поверх любого экрана: что
// изменилось и согласие на установку. Само обновление не ставится.
export function UpdateOffer() {
  const { t } = useTranslation();
  const { update, defer } = useUpdateOffer();
  const current = useAppVersion();
  const { install, installing, progress, problem } = useUpdateInstall();

  if (update === null) {
    return null;
  }

  const items = releaseItems(update.notes);

  return (
    <section
      aria-label={t("updates.offer.label")}
      className="fixed right-4 bottom-4 z-30 flex w-96 flex-col gap-3 rounded-[10px] border border-content/8 bg-shell/95 p-4 text-[13px] text-content shadow-float backdrop-blur-xl"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">{t("updates.offer.title", { version: update.version })}</h2>
        {current !== undefined && (
          <p className="text-content/50">{t("updates.offer.current", { version: current })}</p>
        )}
      </header>

      {items.length > 0 && (
        <ul className="flex max-h-48 list-disc flex-col gap-1 overflow-y-auto pl-4 text-content/70">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="self-start text-link underline-offset-2 hover:underline"
        onClick={() => openLink(releaseUrl(update.version))}
      >
        {t("updates.offer.release")}
      </button>

      {installing && <ProgressLine progress={progress} />}
      {problem !== null && (
        <p role="alert" className="text-diff-del-fg">
          {t(`updates.problems.${problem}`)}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button disabled={installing} onClick={defer}>
          {t("updates.offer.later")}
        </Button>
        <Button disabled={installing} onClick={install}>
          {t("updates.offer.install")}
        </Button>
      </div>
    </section>
  );
}
