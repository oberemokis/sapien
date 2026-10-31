// Настройки шаблонов этого устройства. Форматы даты и времени в знаках
// Obsidian: YYYY год, MM месяц, DD день, HH часы, mm минуты, ss секунды.
export type TemplateSettings = { folder: string; dateFormat: string; timeFormat: string };

export const DEFAULT_TEMPLATES: TemplateSettings = {
  folder: "Шаблоны",
  dateFormat: "YYYY-MM-DD",
  timeFormat: "HH:mm",
};

function text(value: unknown, fallback: string) {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }

  return value.trim();
}

// Папка шаблонов это путь внутри хранилища, как в дереве: без «/» по краям.
export function templateFolder(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

// Из хранилища окна: чего нет или что испорчено, берётся по умолчанию.
export function parseTemplateSettings(raw: unknown): TemplateSettings {
  let value: Record<string, unknown> = {};

  if (typeof raw === "object" && raw !== null) {
    value = { ...raw };
  }

  return {
    folder: templateFolder(text(value.folder, DEFAULT_TEMPLATES.folder)) || DEFAULT_TEMPLATES.folder,
    dateFormat: text(value.dateFormat, DEFAULT_TEMPLATES.dateFormat),
    timeFormat: text(value.timeFormat, DEFAULT_TEMPLATES.timeFormat),
  };
}

export function isTemplate(path: string, folder: string) {
  return path.startsWith(`${folder}/`);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatDate(date: Date, format: string) {
  const parts: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };

  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => parts[token] ?? token);
}

// Подстановки шаблона. Неизвестная, например {{foo}}, остаётся как есть.
export function fillTemplate(template: string, title: string, now: Date, settings: TemplateSettings) {
  const values: Record<string, string> = {
    title,
    date: formatDate(now, settings.dateFormat),
    time: formatDate(now, settings.timeFormat),
  };

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => values[name] ?? whole);
}
