import { createFileRoute } from "@tanstack/react-router";
import { ForgeSettings } from "@sapien/forge";

export const Route = createFileRoute("/settings/integrations")({ component: ForgeSettings });
