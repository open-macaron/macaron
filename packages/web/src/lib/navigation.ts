import type { LucideIcon } from "@lucide/svelte";
import ChartColumnIcon from "@lucide/svelte/icons/chart-column";
import GaugeIcon from "@lucide/svelte/icons/gauge";
import KeyRoundIcon from "@lucide/svelte/icons/key-round";
import MailPlusIcon from "@lucide/svelte/icons/mail-plus";
import ServerIcon from "@lucide/svelte/icons/server";
import UsersIcon from "@lucide/svelte/icons/users";
import type { RouteId } from "$app/types";

export interface NavItem {
  readonly title: string;
  readonly route: RouteId;
  readonly icon: LucideIcon;
}

export interface NavSection {
  readonly label: string;
  readonly items: readonly NavItem[];
  /** Shown to admins only; the controller enforces it, the menu only hides it. */
  readonly adminOnly?: boolean;
}

export const navigation: readonly NavSection[] = [
  {
    label: "Workspace",
    items: [
      { title: "Overview", route: "/(app)", icon: GaugeIcon },
      { title: "Usage", route: "/(app)/usage", icon: ChartColumnIcon },
    ],
  },
  {
    label: "Settings",
    items: [{ title: "LLM key", route: "/(app)/settings/key", icon: KeyRoundIcon }],
  },
  {
    label: "Administration",
    adminOnly: true,
    items: [
      { title: "Users", route: "/(app)/admin/users", icon: UsersIcon },
      { title: "Invitations", route: "/(app)/admin/invitations", icon: MailPlusIcon },
      { title: "Endpoints", route: "/(app)/admin/endpoints", icon: ServerIcon },
    ],
  },
];
