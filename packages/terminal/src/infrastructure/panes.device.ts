import { defineSetting } from "@sapien/device";
import { parsePanes } from "../model/panes";

// Раскладки панелей по сессиям: после перезапуска сессия открывается
// с теми же панелями, а в каждой новая оболочка под прежним экраном.
// Ключ остался от модуля agent окна: сменить его значит потерять
// сохранённые раскладки.
export const panesSetting = defineSetting({
  key: "sapien.agent.panes",
  parse: parsePanes,
  fallback: {},
});
