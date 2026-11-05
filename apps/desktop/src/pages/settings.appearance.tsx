import { createFileRoute } from "@tanstack/react-router";
import { AppearanceSettings } from "@sapien/appearance";

export const Route = createFileRoute("/settings/appearance")({ component: AppearanceSettings });
