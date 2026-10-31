import { createFileRoute } from "@tanstack/react-router";
import { YoutrackSettings } from "@/modules/youtrack";

export const Route = createFileRoute("/settings/integrations")({ component: YoutrackSettings });
