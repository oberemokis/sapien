import type { createApp } from "./app";

// Только тип: desktop импортирует этот файл, и значимый импорт отсюда утащил
// бы сервер в бандл окна. Это стережёт scripts/check-boundaries.mjs.
export type AppType = ReturnType<typeof createApp>;
