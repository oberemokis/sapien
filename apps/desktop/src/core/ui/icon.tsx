import { ICONS, type IconName } from "./icons";

type Props = {
  icon: IconName;
  size?: number;
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
