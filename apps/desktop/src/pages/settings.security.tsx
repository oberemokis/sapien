import { createFileRoute } from "@tanstack/react-router";
import { SecuritySettings } from "@/modules/security";

export const Route = createFileRoute("/settings/security")({ component: SecuritySettings });
