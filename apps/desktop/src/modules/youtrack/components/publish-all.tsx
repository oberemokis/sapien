import { useState } from "react";
import { useTranslation } from "react-i18next";
import { withFrontmatterValue } from "@/core/markdown/frontmatter";
import { Button } from "@/core/ui/button";
import { useCheck, usePublish } from "../interactions/draft";
import { familyOf, localFindings, remoteFindings } from "../model/check";
import {
  draftRequest,
  ISSUE_KEY,
  noteTitle,
  parseDraft,
  resolveLinks,
  type LinkedNote,
  type TaskDraft,
} from "../model/draft";
import { youtrackProblemOf } from "../model/youtrack";
import { Alert, AlertAction } from "./alert";

type Props = {
  path: string;
  draft: TaskDraft;
  text: string;
  notes: LinkedNote[];
  // Есть сеть, YouTrack подключён, заметку можно править.
  ready: boolean;
  onWrite: (path: string, text: string, from: string) => Promise<boolean>;
  onOpen: (path: string) => void;
};

// Где публикация остановилась и почему, уже текстом для человека.
type Stop = { path: string; reason: string };

// Заметки хранилища с текстом этой на сейчас: в кеше хранилища может
// лежать текст до последней правки.
function withText(notes: LinkedNote[], path: string, text: string) {
  return [...notes.filter((note) => note.path !== path), { path, text }];
}

function linkedOf(texts: Map<string, string>) {
  return [...texts].map(([path, text]) => ({ path, text }));
}

// «Опубликовать всё» у черновика, на который ведёт parent других черновиков:
// эпик и его задачи уходят в YouTrack по порядку связей.
export function PublishAll({ path, draft, text, notes, ready, onWrite, onOpen }: Props) {
  const { t } = useTranslation();
  const checking = useCheck();
  const publishing = usePublish();
  const [progress, setProgress] = useState<{ number: number; total: number; title: string } | null>(null);
  const [stop, setStop] = useState<Stop | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const family = familyOf(path, draft, withText(notes, path, text));
  const left = family.filter((member) => member.draft.id === null).length;

  if (family.length < 2) {
    return null;
  }

  // Каждый черновик проходит проверку связей, публикуется, и номер задачи
  // сразу встаёт в его заметку. Черновик с номером уже задача: повтор после
  // обрыва его пропускает и продолжает с того же места.
  async function run() {
    const texts = new Map(withText(notes, path, text).map((note) => [note.path, note.text]));
    const order = familyOf(path, draft, linkedOf(texts)).filter((member) => member.draft.id === null);
    const failed: string[] = [];

    setStop(null);
    setDone(null);
    setRejected([]);

    for (const [index, member] of order.entries()) {
      const before = texts.get(member.path) ?? "";
      const title = noteTitle(member.path);
      const linked = linkedOf(texts);
      const now = parseDraft(before, title) ?? member.draft;
      const halt = (reason: string) => {
        setProgress(null);
        setStop({ path: member.path, reason });
      };

      setProgress({ number: index + 1, total: order.length, title });

      try {
        // oxlint-disable-next-line no-await-in-loop -- по очереди: связь встаёт номером предыдущей задачи
        const checked = await checking.mutateAsync(draftRequest(now));
        const findings = [...localFindings(member.path, now, linked), ...remoteFindings(member.path, now, linked, checked)];

        if (findings.some((finding) => finding.blocking)) {
          halt(t("youtrack.publishAll.blocked", { title }));
          return;
        }

        const resolved = resolveLinks(now, linked);

        if (resolved.unpublished.length > 0) {
          halt(t("youtrack.publishAll.unpublished", { title, target: noteTitle(resolved.unpublished[0] ?? "") }));
          return;
        }

        // oxlint-disable-next-line no-await-in-loop -- по очереди: связь встаёт номером предыдущей задачи
        const published = await publishing.mutateAsync({
          path: member.path,
          text: before,
          draft: draftRequest(resolved.draft),
          id: null,
          force: false,
        });

        if (published.kind === "missing") {
          halt(t("youtrack.publishAll.missing", { title, fields: published.fields.join(", ") }));
          return;
        }

        if (published.kind === "diverged") {
          halt(t("youtrack.publishAll.problem", { title, problem: t("youtrack.problems.failed") }));
          return;
        }

        const next = withFrontmatterValue(before, ISSUE_KEY, published.id);

        // oxlint-disable-next-line no-await-in-loop -- номер должен лечь в заметку до следующей задачи
        if (!(await onWrite(member.path, next, before))) {
          halt(t("youtrack.publishAll.unwritten", { title, id: published.id }));
          return;
        }

        texts.set(member.path, next);

        if (published.failed.length > 0) {
          failed.push(t("youtrack.draft.failed", { id: published.id, commands: published.failed.join("; ") }));
        }
      } catch (error) {
        halt(t("youtrack.publishAll.problem", { title, problem: t(`youtrack.problems.${youtrackProblemOf(error)}`) }));
        return;
      }
    }

    setProgress(null);
    setDone(order.length);
    setRejected(failed);
  }

  return (
    <section aria-label={t("youtrack.publishAll.title")} className="flex flex-col gap-1.5 border-t border-hairline pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{t("youtrack.publishAll.title")}</h3>
        <span className="text-content/60">{t("youtrack.publishAll.count", { total: family.length, left })}</span>
        <div className="ml-auto flex gap-2">
          <Button disabled={!ready || left === 0 || progress !== null} onClick={() => void run()}>
            {t("youtrack.publishAll.run")}
          </Button>
        </div>
      </div>
      <ol className="flex flex-wrap gap-x-3 gap-y-0.5 text-content/60">
        {family.map((member, index) => (
          <li key={member.path}>
            {index + 1}. {noteTitle(member.path)}: {member.draft.id ?? t("youtrack.publishAll.draft")}
          </li>
        ))}
      </ol>
      <p className="text-content/60">{t("youtrack.publishAll.hint")}</p>
      {progress !== null && <output>{t("youtrack.publishAll.progress", progress)}</output>}
      {done !== null && <output className="text-content/60">{t("youtrack.publishAll.done", { number: done })}</output>}
      {stop !== null && (
        <Alert
          action={
            <AlertAction onClick={() => onOpen(stop.path)}>
              {t("youtrack.check.open", { title: noteTitle(stop.path) })}
            </AlertAction>
          }
        >
          {stop.reason}
        </Alert>
      )}
      {rejected.map((line) => (
        <Alert key={line}>{line}</Alert>
      ))}
    </section>
  );
}
