import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native";
import { useCSSVariable } from "uniwind";

// Толщина линии иконок MonoCode, та же, что у окна.
const STROKE_WIDTH = 1.75;

type Token = "--color-content" | "--color-content-muted" | "--color-accent";

type Props = {
  // Иконка берётся глубоким путём, `@hugeicons/core-free-icons/Settings01Icon`:
  // корень пакета тащит в сборку весь каталог, его запрещает oxlint.
  icon: IconSvgElement;
  size?: number;
  // Цвет только токеном темы: svg не наследует цвет текста вокруг.
  color?: Token;
};

export function Icon({ icon, size = 20, color = "--color-content" }: Props) {
  const value = useCSSVariable(color);

  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={STROKE_WIDTH}
      color={String(value)}
    />
  );
}
