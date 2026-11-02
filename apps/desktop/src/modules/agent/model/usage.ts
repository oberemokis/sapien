// Окно лимита подписки, как Limit в domain.rs: used это израсходованные
// проценты от 0 до 100, resets время сброса ISO 8601.
export type Limit = { used: number; resets: string | null };

// Лимиты подписки Claude, как Usage в domain.rs. available ложно, когда
// вход не по подписке. Окно null: claude.ai о нём не сказал.
export type Usage = { available: boolean; fiveHour: Limit | null; sevenDay: Limit | null };

// Сколько осталось до сброса в днях, часах и минутах. Минуты округляются
// вверх: «через 0 мин» за полминуты до сброса было бы неправдой.
export function untilReset(resets: string, now: number) {
  const minutes = Math.max(0, Math.ceil((Date.parse(resets) - now) / 60_000));

  return { days: Math.floor(minutes / 1440), hours: Math.floor(minutes / 60) % 24, minutes: minutes % 60 };
}
