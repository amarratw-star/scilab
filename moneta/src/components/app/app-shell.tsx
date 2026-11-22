"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { ArrowLeftRight, Bell, Gauge, LayoutDashboard, LogOut, Menu, Monitor, Moon, Plus, Search, Settings, Sun, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo, LogoMark } from "./logo";
import { NAV_GROUPS, ALL_NAV } from "./nav";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { logoutAction } from "@/app/actions/auth";
import { CommandPalette } from "./command-palette";
import { QuickAddDialog, type QuickAddPreset } from "@/components/forms/quick-add";
import { CurrencyProvider } from "./currency";

export type RefAccount = { id: string; name: string; type: string; color: string; icon: string; currency?: string };
export type RefCategory = { id: string; name: string; kind: "expense" | "income"; parentId: string | null; icon: string; color: string };
export type RefData = { accounts: RefAccount[]; categories: RefCategory[]; unread: number; today: string; currency: string };

const RefContext = createContext<RefData | null>(null);
const QuickAddContext = createContext<(preset?: QuickAddPreset) => void>(() => {});

export function useRefData() {
  const v = useContext(RefContext);
  if (!v) throw new Error("useRefData hors AppShell");
  return v;
}
export function useQuickAdd() {
  return useContext(QuickAddContext);
}

export function AppShell({ user, refData, children }: { user: { displayName: string; email: string; isDemo: boolean; hasDemoData: boolean }; refData: RefData; children: React.ReactNode }) {
  const pathname = usePathname();
  const [quick, setQuick] = useState<{ open: boolean; preset?: QuickAddPreset }>({ open: false });
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const openQuick = useCallback((preset?: QuickAddPreset) => setQuick({ open: true, preset }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      if (!typing && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openQuick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openQuick]);

  useEffect(() => setMoreOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const demo = user.isDemo || user.hasDemoData;

  return (
    <CurrencyProvider currency={refData.currency}>
    <RefContext.Provider value={refData}>
      <QuickAddContext.Provider value={openQuick}>
        <div className="min-h-dvh lg:pl-64">
          {/* Barre latérale (ordinateur) */}
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
            <div className="flex h-16 items-center px-5">
              <Link href="/" aria-label="Accueil">
                <Logo />
              </Link>
            </div>
            <div className="px-3 pb-3">
              <button
                onClick={() => openQuick()}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
              >
                <Plus className="size-4" /> Ajouter une opération
                <kbd className="ml-1 rounded border border-white/20 px-1 text-[10px] opacity-60 dark:border-black/20">N</kbd>
              </button>
            </div>
            <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6" aria-label="Navigation principale">
              {NAV_GROUPS.map((g) => (
                <div key={g.label}>
                  <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">{g.label}</p>
                  <ul className="space-y-0.5">
                    {g.items.map((it) => (
                      <li key={it.href}>
                        <Link
                          href={it.href}
                          aria-current={isActive(it.href) ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                            isActive(it.href) ? "bg-surface-2 font-medium text-foreground" : "text-muted hover:bg-surface-2/60 hover:text-foreground",
                          )}
                        >
                          <it.icon className="size-4" aria-hidden />
                          {it.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
            <UserMenu user={user} />
          </aside>

          {/* Barre supérieure */}
          <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-xl">
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6 lg:h-16 lg:px-8">
              <Link href="/" className="lg:hidden" aria-label="Accueil">
                <LogoMark />
              </Link>
              <button
                onClick={() => setSearchOpen(true)}
                className="ml-1 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm text-subtle transition hover:border-border-strong sm:max-w-md"
                aria-label="Rechercher"
              >
                <Search className="size-4" />
                <span className="truncate">Rechercher une opération, un compte…</span>
                <kbd className="ml-auto hidden rounded-md border border-border px-1.5 text-[10px] sm:inline">⌘K</kbd>
              </button>
              <div className="ml-auto flex items-center gap-1">
                <ThemeToggle />
                <Link href="/notifications" className="relative rounded-xl p-2 text-muted hover:bg-surface-2 hover:text-foreground" aria-label={`Notifications${refData.unread ? ` (${refData.unread} non lues)` : ""}`}>
                  <Bell className="size-5" />
                  {refData.unread > 0 && <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-semibold leading-4 text-white">{refData.unread > 9 ? "9+" : refData.unread}</span>}
                </Link>
                <div className="lg:hidden">
                  <MobileUserMenu user={user} />
                </div>
              </div>
            </div>
            {demo && (
              <div className="flex items-center justify-center gap-2 border-t border-warning/20 bg-warning-soft px-4 py-1.5 text-center text-xs text-warning">
                <TriangleAlert className="size-3.5 shrink-0" />
                <span>
                  <strong>Données de démonstration fictives</strong> — aucune n&apos;est réelle.{" "}
                  {!user.isDemo && (
                    <Link href="/parametres#donnees" className="underline underline-offset-2">
                      Les supprimer et démarrer à vide
                    </Link>
                  )}
                  {user.isDemo && "Espace temporaire supprimé sous 48 h."}
                </span>
              </div>
            )}
          </header>

          <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8 animate-fade-in">{children}</main>

          {/* Navigation inférieure (mobile) */}
          <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/90 backdrop-blur-xl lg:hidden" aria-label="Navigation mobile">
            <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
              <BottomLink href="/" label="Accueil" icon={LayoutDashboard} active={isActive("/")} />
              <BottomLink href="/transactions" label="Opérations" icon={ArrowLeftRight} active={isActive("/transactions")} />
              <div className="flex justify-center">
                <button
                  onClick={() => openQuick()}
                  className="-mt-7 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition active:scale-95"
                  aria-label="Ajout rapide"
                >
                  <Plus className="size-6" />
                </button>
              </div>
              <BottomLink href="/budgets" label="Budgets" icon={Gauge} active={isActive("/budgets")} />
              <button onClick={() => setMoreOpen(true)} className={cn("flex flex-col items-center gap-0.5 text-[10px]", moreOpen ? "text-foreground" : "text-muted")}>
                <Menu className="size-5" />
                Plus
              </button>
            </div>
          </nav>

          {moreOpen && (
            <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal aria-label="Menu">
              <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setMoreOpen(false)} />
              <div className="safe-bottom absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-surface p-5 animate-slide-up">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-semibold">Toutes les rubriques</p>
                  <button onClick={() => setMoreOpen(false)} className="rounded-lg p-1.5 hover:bg-surface-2" aria-label="Fermer">
                    <X className="size-5" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {ALL_NAV.map((it) => (
                    <Link
                      key={it.href}
                      href={it.href}
                      className={cn("flex flex-col items-center gap-1.5 rounded-2xl border border-border p-3 text-center text-[11px] leading-tight", isActive(it.href) ? "bg-surface-2 font-medium" : "text-muted")}
                    >
                      <it.icon className="size-5" />
                      {it.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} onQuickAdd={(p) => openQuick(p)} />
          <QuickAddDialog open={quick.open} preset={quick.preset} onOpenChange={(open) => setQuick((q) => ({ ...q, open }))} />
        </div>
      </QuickAddContext.Provider>
    </RefContext.Provider>
    </CurrencyProvider>
  );
}

function BottomLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 text-[10px]", active ? "font-medium text-foreground" : "text-muted")}>
      <Icon className="size-5" />
      {label}
    </Link>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = !mounted ? Monitor : theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = !mounted ? "Thème" : theme === "light" ? "Mode clair" : theme === "dark" ? "Mode sombre" : "Thème du système";
  return (
    <button onClick={() => setTheme(next)} className="rounded-xl p-2 text-muted hover:bg-surface-2 hover:text-foreground" aria-label={`${label} — changer`} title={label}>
      <Icon className="size-5" />
    </button>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function UserMenu({ user }: { user: { displayName: string; email: string } }) {
  return (
    <div className="border-t border-border p-3">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold">{initials(user.displayName)}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.displayName}</span>
            <span className="block truncate text-xs text-subtle">{user.email}</span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <UserMenuItems />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MobileUserMenu({ user }: { user: { displayName: string; email: string } }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="ml-1 flex size-8 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold" aria-label="Mon compte">
        {initials(user.displayName)}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <UserMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenuItems() {
  const router = useRouter();
  return (
    <>
      <DropdownMenuItem onSelect={() => router.push("/parametres")}>
        <Settings /> Paramètres
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem destructive onSelect={() => logoutAction()}>
        <LogOut /> Se déconnecter
      </DropdownMenuItem>
    </>
  );
}

export function useAccountName() {
  const { accounts } = useRefData();
  return useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
}
