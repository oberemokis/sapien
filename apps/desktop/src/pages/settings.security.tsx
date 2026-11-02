import { createFileRoute } from "@tanstack/react-router";
import { LockSettings } from "@/modules/security";

export const Route = createFileRoute("/settings/security")({ component: LockSettings });
