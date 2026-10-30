import { createFileRoute, redirect } from "@tanstack/react-router";

// Без раздела в адресе открывается первый.
export const Route = createFileRoute("/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/appearance", replace: true });
  },
});
