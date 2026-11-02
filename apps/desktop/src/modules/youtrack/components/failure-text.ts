import type { TFunction } from "i18next";
import type { YoutrackFailure } from "../model/youtrack";

// Текст отказа: перевод по коду и, если YouTrack объяснил отказ, его
// объяснение как есть. Перевести его нельзя, а без него причину не найти.
export function failureText(t: TFunction, { problem, detail }: YoutrackFailure): string {
  const text = t(`youtrack.problems.${problem}`);

  if (detail === null) {
    return text;
  }

  return `${text} ${t("youtrack.answer", { detail })}`;
}
