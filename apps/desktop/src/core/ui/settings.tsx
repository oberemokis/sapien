import type { ReactNode } from "react";

// Раздел настроек: заголовок с пояснением и колонка групп под ним.
// Вид MonoCode, общий для разделов из разных модулей.
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
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-content/60">{description}</p>
      </header>
      {children}
    </div>
  );
}

// Группа строк в карточке. Заголовок группы необязателен: в разделе
// из одной группы он повторял бы заголовок раздела.
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
    <section className="flex flex-col gap-3">
      {title !== undefined && (
        <header className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description !== undefined && <p className="text-[13px] text-content/50">{description}</p>}
        </header>
      )}
      <div className="divide-y divide-hairline rounded-[10px] border border-stroke">{children}</div>
    </section>
  );
}

// Строка: название, под ним пояснение серым, справа управление.
export function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-6 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-[13px] text-content/50">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
