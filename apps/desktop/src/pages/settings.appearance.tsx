import { createFileRoute } from "@tanstack/react-router";
import { AppearanceSettings } from "@/modules/appearance";

export const Route = createFileRoute("/settings/appearance")({ component: AppearanceSettings });
