import type { ReactNode } from "react";

// Поле ввода в строке настроек, как TextInput дизайн-системы: край даёт
// тень-кольцо, фокус обводит синим. Ширину задаёт место, где поле стоит.
export const FIELD =
  "h-7 rounded-md bg-bg-base px-2 text-[13px] text-text-base shadow-input outline-1 -outline-offset-1 outline-transparent transition-[outline-color] duration-120 placeholder:text-text-faint focus:outline-border-focus";

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
    <div className="flex items-center gap-4 py-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[13px]/4 font-medium">{title}</p>
        <p className="text-[13px]/5 text-text-muted">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
