import Note01Icon from "@hugeicons/core-free-icons/Note01Icon";
import { createFileRoute } from "@tanstack/react-router";
import { Icon } from "@/core/ui/icon";

export const Route = createFileRoute("/")({ component: Home });

// Пустое состояние до раскладки окна (#2): строка серого текста под иконкой.
function Home() {
  return (
    <main className="grid h-full place-items-center bg-background-base">
      <div className="flex flex-col items-center gap-2 text-content/50">
        <Icon icon={Note01Icon} size={20} />
        <p className="text-sm">sapien</p>
      </div>
    </main>
  );
}
