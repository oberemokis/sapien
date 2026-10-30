// Загрузка после первой отрисовки и подбор иконки по составному расширению
// повторяют src/features/files/ui/FileTypeIcon.tsx из MonoCode
// (https://github.com/hardbeat920/monocode, коммит fc01ae25afef). MIT,
// Copyright (c) 2026 Nick, полный текст в THIRD_PARTY_NOTICES.md.
import { memo, useSyncExternalStore } from "react";

type IconPack = typeof import("react-material-icon-theme");

type Props = {
  name: string;
  isFolder?: boolean;
  isOpen?: boolean;
  size?: number;
};

// Пакет несёт все глифы разом, около 1.1 МБ, ради значков в 16px. Он грузится
// отдельным куском после первой отрисовки, а до тех пор на месте значка
// пустое место того же размера: приложение стартует без него, и ничего
// не сдвигается, когда он приходит.
let pack: IconPack | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function loadPack() {
  if (pack !== null || loading !== null) {
    return;
  }

  loading = import("react-material-icon-theme").then((module) => {
    pack = module;

    for (const listener of listeners) {
      listener();
    }
  });
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  loadPack();

  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot() {
  return pack;
}

export const FileTypeIcon = memo(function FileTypeIcon({
  name,
  isFolder = false,
  isOpen = false,
  size = 16,
}: Props) {
  const icons = useSyncExternalStore(subscribe, getSnapshot);
  const box = { width: size, height: size };

  if (icons === null) {
    return (
      <span aria-hidden className="inline-block shrink-0" style={box} />
    );
  }

  const iconName = isFolder
    ? icons.getFolderIcon({ folderName: name, isOpen })
    : fileIconName(icons, name);
  const svg = icons.getIconSvg(iconName) ?? icons.getIconSvg("file") ?? "";

  // Картинкой, а не разметкой: имя файла пришло от пользователя, и в DOM
  // из пакета не попадает ничего, что могло бы выполниться.
  return (
    <img
      alt=""
      aria-hidden
      draggable={false}
      className="inline-block shrink-0"
      style={box}
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
    />
  );
});

// Пакет смотрит на расширение, только если его передать отдельно, а сам
// из имени его не выделяет. Поэтому сначала полное имя (`package.json`),
// потом составные расширения от длинного к короткому (`d.ts`, затем `ts`).
// Пустой iconPack выключает набор Angular, который пакет включает сам:
// иначе `x.service.ts` получает значок Angular, а не TypeScript.
function fileIconName(icons: IconPack, fileName: string) {
  const name = fileName.toLowerCase();
  const byName = icons.getFileIcon({ fileName: name, fallback: "", iconPack: "" });

  if (byName !== "") {
    return byName;
  }

  for (const extension of compoundExtensions(name)) {
    const byExtension = icons.getFileIcon({
      fileExtension: extension,
      fallback: "",
      iconPack: "",
    });

    if (byExtension !== "") {
      return byExtension;
    }
  }

  return "file";
}

function compoundExtensions(fileName: string) {
  const parts = fileName.split(".");
  // Точка в начале имени (`.gitignore`) расширение не отделяет.
  const start = Number(parts[0] === "") + 1;

  return parts.slice(start).map((_, index) => parts.slice(start + index).join("."));
}
