import {
  ArrowLeftRight, BarChart3, Bot, Calculator, CalendarDays, FileText, FolderOpen, Gauge, Landmark, LayoutDashboard, PiggyBank, Repeat, ScanLine, Settings, TrendingUp, Upload, Wallet, Coins, type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Pilotage",
    items: [
      { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
      { href: "/comptes", label: "Comptes", icon: Wallet },
      { href: "/budgets", label: "Budgets", icon: Gauge },
      { href: "/epargne", label: "Épargne", icon: PiggyBank },
      { href: "/abonnements", label: "Abonnements", icon: Repeat },
      { href: "/calendrier", label: "Calendrier", icon: CalendarDays },
    ],
  },
  {
    label: "Comprendre & décider",
    items: [
      { href: "/disponible", label: "Combien dépenser ?", icon: Coins },
      { href: "/analyses", label: "Analyses", icon: BarChart3 },
      { href: "/conseiller", label: "Mon conseiller", icon: Bot },
      { href: "/simulateur", label: "Simulateur", icon: Calculator },
      { href: "/previsions", label: "Prévisions", icon: TrendingUp },
      { href: "/patrimoine", label: "Mon patrimoine", icon: Landmark },
    ],
  },
  {
    label: "Outils",
    items: [
      { href: "/documents", label: "Documents", icon: FolderOpen },
      { href: "/rapports", label: "Rapports", icon: FileText },
      { href: "/import", label: "Importer un relevé", icon: Upload },
      { href: "/scanner", label: "Scanner un ticket", icon: ScanLine },
      { href: "/parametres", label: "Paramètres", icon: Settings },
    ],
  },
];

export const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);
