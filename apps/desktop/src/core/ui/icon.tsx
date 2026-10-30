import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

// Толщина линии иконок MonoCode.
const STROKE_WIDTH = 1.75;

type Props = {
  // Иконка берётся глубоким путём, `@hugeicons/core-free-icons/Settings01Icon`:
  // корень пакета тащит в сборку весь каталог, его запрещает oxlint.
  icon: IconSvgElement;
  size?: number;
  className?: string;
};

// Цвет иконка берёт у текста вокруг, поэтому красится теми же токенами.
export function Icon({ icon, size = 16, className }: Props) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={STROKE_WIDTH}
      className={className}
      aria-hidden
    />
  );
}
