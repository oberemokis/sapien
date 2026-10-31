import { createStore } from "@tanstack/react-store";
import { DEFAULT_TEMPLATES, type TemplateSettings } from "../model/templates";

// Папка шаблонов и форматы подстановок даты и времени.
export const templatesStore = createStore<TemplateSettings>(DEFAULT_TEMPLATES);
