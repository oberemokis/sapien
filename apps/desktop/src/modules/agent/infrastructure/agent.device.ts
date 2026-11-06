import { defineSetting } from "@sapien/device";
import { isIds, parseSessionOrder } from "../model/sessions";
import { NO_TABS, parseTabs } from "../model/tabs";

function parseCollapsed(stored: unknown): string[] {
  if (isIds(stored)) {
    return stored;
  }

  return [];
}

// Сессии, у которых в левой панели свёрнута ветка агентов.
export const collapsedSetting = defineSetting({
  key: "sapien.agent.collapsed",
  parse: parseCollapsed,
  fallback: [],
});

// Порядок сессий в левой панели, который человек задал перетаскиванием.
export const sessionOrderSetting = defineSetting({
  key: "sapien.agent.order",
  parse: parseSessionOrder,
  fallback: {},
});

// Открытые вкладки: после перезапуска окно открывает их же.
export const tabsSetting = defineSetting({
  key: "sapien.agent.tabs",
  parse: (stored) => parseTabs(stored) ?? NO_TABS,
  fallback: NO_TABS,
});
