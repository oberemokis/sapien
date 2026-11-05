import type { ReactNode } from "react";
import { Icon } from "./icon";

// Поле ввода в строке настроек, как TextInput дизайн-системы: край даёт
// тень-кольцо, фокус обводит синим. Ширину задаёт место, где поле стоит.
export const FIELD =
  "h-7 rounded-md bg-bg-base px-2 text-[13px] text-text-base shadow-input outline-1 -outline-offset-1 outline-transparent transition-[outline-color] duration-120 placeholder:text-text-faint focus:outline-border-focus";

// Переключатель как в opencode: прямоугольная дорожка, включённая синяя.
// Под видом обычный checkbox с role="switch", ползунок рисует ::before.
export const SWITCH =
  "relative h-4 w-7 shrink-0 appearance-none rounded-[4px] bg-bg-layer-03 transition-colors duration-120 before:absolute before:top-0.5 before:left-0.5 before:size-3 before:rounded-[3px] before:bg-(--grey-50) before:transition-transform before:duration-120 checked:bg-bg-accent checked:before:translate-x-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:opacity-50";

// Раздел настроек: заголовок с пояснением и колонка групп под ним.
// Общий для разделов из разных модулей.
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-240 flex-col gap-10 px-8 py-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[15px]/5 font-[640]">{title}</h1>
        <p className="text-[13px]/5 text-text-muted">{description}</p>
      </header>
      {children}
    </div>
  );
}

// Группа строк на подложке. Заголовок группы необязателен: в разделе
// из одной группы он повторял бы заголовок раздела. Линии между строками
// не доходят до краёв подложки, как в opencode.
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      {title !== undefined && (
        <header className="flex flex-col gap-1">
          <h2 className="text-[13px]/4 font-medium">{title}</h2>
          {description !== undefined && <p className="text-[13px]/5 text-text-muted">{description}</p>}
        </header>
      )}
      <div className="divide-y-[0.5px] divide-border-base rounded-lg bg-bg-layer-01 px-5 shadow-[inset_0_0_0_0.5px_var(--border-border-muted)]">
        {children}
      </div>
    </section>
  );
}

// Строка: название, под ним пояснение серым, справа управление.
export function SettingsRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[13px]/5 font-medium">{title}</p>
        <p className="text-[13px]/5 text-text-muted">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

type SelectProps<Value extends string> = {
  label: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string }>;
  onChange: (value: Value) => void;
};

// Выбор из списка в строке: значение текстом со стрелкой, без рамки, как
// в opencode. Под видом обычный select, список показывает система.
export function SettingsSelect<Value extends string>({ label, value, options, onChange }: SelectProps<Value>) {
  return (
    <span className="relative flex items-center">
      <select
        aria-label={label}
        value={value}
        className="h-7 cursor-default appearance-none rounded-md bg-transparent pr-7 pl-2 text-right text-[13px] font-medium text-text-base outline-none transition-colors duration-120 hover:bg-overlay-hover focus-visible:outline-2 focus-visible:outline-border-focus"
        onChange={(event) => {
          const picked = options.find((option) => option.value === event.target.value);

          if (picked !== undefined) {
            onChange(picked.value);
          }
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon icon="chevron-down" size={14} className="pointer-events-none absolute right-2 text-icon-muted" />
    </span>
  );
}
