import { z } from "zod";

// У api порт 3400, а не 3000: на трёх тысячах сидит почти каждый локальный
// сервер. Тот же адрес по умолчанию ждёт клиент в apps/desktop.
const DEFAULT_PORT = 3400;

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
});

export type Env = z.infer<typeof EnvSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Некорректное окружение сервера:\n${issues}`);
  }

  return parsed.data;
}
