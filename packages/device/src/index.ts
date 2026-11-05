// Настройка устройства: выбор человека, который живёт в localStorage окна,
// а не в файлах Rust. Тема, язык, раскладка, открытые вкладки.
export type Setting<T> = {
  read: () => T;
  write: (value: T) => void;
};

type Options<T> = {
  // Ключ в localStorage. Сменить его значит потерять выбор, сделанный
  // под прежним.
  key: string;
  // Сохранённое могло побиться или остаться от другой версии: parse
  // приводит его к значению сам, а не падает.
  parse: (stored: unknown) => T;
  // Значение, когда записи нет, она не разбирается или хранилище закрыто.
  fallback: T;
  // Значение лежит строкой как есть, а не JSON: так записаны язык, тема
  // и масштаб.
  text?: boolean;
};

// Хранилище окна бывает закрыто политикой: тогда чтение отдаёт fallback,
// запись пропадает, и выбор живёт до закрытия окна, а приложение не падает.
export function defineSetting<T>({ key, parse, fallback, text = false }: Options<T>): Setting<T> {
  return {
    read() {
      try {
        const stored = localStorage.getItem(key);

        if (stored === null) {
          return fallback;
        }

        if (text) {
          return parse(stored);
        }

        return parse(JSON.parse(stored));
      } catch {
        return fallback;
      }
    },
    write(value) {
      try {
        if (text) {
          localStorage.setItem(key, String(value));
        } else {
          localStorage.setItem(key, JSON.stringify(value));
        }
      } catch {
        // Выбор уже на экране, без записи он только не переживёт перезапуск.
      }
    },
  };
}
