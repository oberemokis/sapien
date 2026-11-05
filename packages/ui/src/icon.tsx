import { ICONS, type IconName } from "./icons";

type Props = {
  icon: IconName;
  // Размеры opencode: 14 мелкая, 16 обычная, 20 крупная, 32 иконка
  // на весь экран. Линии иконок в пиксель толщиной стоят на сетке 16
  // и 20, и на промежуточном размере вроде 15 они расплываются.
  size?: 14 | 16 | 20 | 32;
  className?: string;
};

// Иконка opencode 2.0 по имени. Цвет она берёт у текста вокруг
// (currentColor), поэтому красится теми же токенами.
export function Icon({ icon, size = 16, className }: Props) {
  const { viewBox, body } = ICONS[icon];

  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" aria-hidden className={className}>
      {body}
    </svg>
  );
}
