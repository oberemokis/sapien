import { startI18n } from "@sapien/i18n";
import { changeLanguage } from "i18next";
import { dictionary } from "./dictionary";

// Тесты ищут элементы по русским подписям, как в окне с выбранным русским.
startI18n({ forge: dictionary });
void changeLanguage("ru");
