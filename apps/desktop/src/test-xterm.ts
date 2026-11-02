// xterm.js для тестов: happy-dom не меряет шрифт, и настоящий терминал
// в нём не рисует. Вывод ложится текстом в разметку, ввод печатает type.
type Listener<T> = (value: T) => void;

export class Terminal {
  // Терминалы, созданные за тест, по порядку.
  static created: Terminal[] = [];

  cols = 80;
  rows = 24;
  options: Record<string, unknown>;
  element: HTMLElement | null = null;
  disposed = false;
  private readonly typed: Listener<string>[] = [];
  private readonly resized: Listener<{ cols: number; rows: number }>[] = [];
  private readonly decoder = new TextDecoder();

  constructor(options: Record<string, unknown> = {}) {
    this.options = { ...options };
    Terminal.created.push(this);
  }

  loadAddon() {}

  open(parent: HTMLElement) {
    this.element = parent;
  }

  write(data: string | Uint8Array) {
    if (typeof data === "string") {
      this.element?.append(data);
      return;
    }

    this.element?.append(this.decoder.decode(data, { stream: true }));
  }

  onData(listener: Listener<string>) {
    this.typed.push(listener);
    return { dispose() {} };
  }

  onResize(listener: Listener<{ cols: number; rows: number }>) {
    this.resized.push(listener);
    return { dispose() {} };
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;

    for (const listener of this.resized) {
      listener({ cols, rows });
    }
  }

  focus() {}

  dispose() {
    this.disposed = true;
  }

  // Человек набрал text в терминале.
  type(text: string) {
    for (const listener of this.typed) {
      listener(text);
    }
  }
}

export class FitAddon {
  fit() {}
}
