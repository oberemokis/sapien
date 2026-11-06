// Разделы по группам, порядок как на экране. Раздел появляется вместе со
// своей задачей: страница в pages/settings.<раздел>.tsx и строка здесь.
// Название раздела берётся из словаря его пакета: «пакет:ключ».
export const SETTINGS_GROUPS = [
  {
    label: "settings.groups.app",
    sections: [
      { to: "/settings/appearance", label: "appearance:title", icon: "appearance" },
      { to: "/settings/security", label: "security:title", icon: "lock" },
    ],
  },
  {
    label: "settings.groups.workspace",
    sections: [{ to: "/settings/integrations", label: "forge:title", icon: "extensions" }],
  },
] as const;

// Пространства имён, из которых берутся названия разделов.
export const SECTION_NAMESPACES = ["translation", "appearance", "security", "forge"] as const;
