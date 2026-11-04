import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  title: string;
  // Имя поля для чтения с экрана: вкладки или сессии.
  label: string;
  // Ширина и отступ поля на месте строки.
  className: string;
  onDone: (title: string | null) => void;
};

// Поле имени сессии на месте вкладки или строки левой панели. Enter и уход
// фокуса сохраняют, Escape отменяет. null: имя не меняли.
export function RenameField({ title, label, className, onDone }: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function finish(value: string | null) {
    if (!done.current) {
      done.current = true;
      onDone(value);
    }
  }

  return (
    <input
      ref={input}
      aria-label={label}
      defaultValue={title}
      placeholder={t("agent.sessions.untitled")}
      maxLength={100}
      className={`h-7 rounded-md bg-overlay-pressed text-[13px] text-text-base outline-2 -outline-offset-2 outline-border-focus placeholder:text-text-faint ${className}`}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          finish(event.currentTarget.value);
        }

        if (event.key === "Escape") {
          finish(null);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}
