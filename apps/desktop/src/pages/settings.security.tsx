import { createFileRoute } from "@tanstack/react-router";
import { LockSettings } from "@sapien/security";

export const Route = createFileRoute("/settings/security")({ component: LockSettings });
