import { createFileRoute } from "@tanstack/react-router";
import { ForgeSettings } from "@/modules/forge";

export const Route = createFileRoute("/settings/integrations")({ component: ForgeSettings });
