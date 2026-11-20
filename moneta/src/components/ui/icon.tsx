import {
  Banknote, Briefcase, Building, Building2, Car, Coffee, CreditCard, Dumbbell, Fuel, Gamepad2, Gift, GraduationCap, HandCoins, HeartPulse, Home, Landmark, Laptop, LineChart, Palmtree,
  PartyPopper, Percent, PiggyBank, Plane, PlusCircle, Repeat, Shield, Shirt, ShoppingBag, ShoppingCart, Smartphone, Tag, Target, Train, TrendingUp, Undo2, Utensils, Wallet, Zap, type LucideIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  banknote: Banknote, briefcase: Briefcase, building: Building, "building-2": Building2, car: Car, coffee: Coffee, "credit-card": CreditCard, dumbbell: Dumbbell, fuel: Fuel,
  "gamepad-2": Gamepad2, gift: Gift, "graduation-cap": GraduationCap, "hand-coins": HandCoins, "heart-pulse": HeartPulse, home: Home, landmark: Landmark, laptop: Laptop, "line-chart": LineChart,
  palmtree: Palmtree, "party-popper": PartyPopper, percent: Percent, "piggy-bank": PiggyBank, plane: Plane, "plus-circle": PlusCircle, repeat: Repeat, shield: Shield, shirt: Shirt,
  "shopping-bag": ShoppingBag, "shopping-cart": ShoppingCart, smartphone: Smartphone, tag: Tag, target: Target, train: Train, "trending-up": TrendingUp, "undo-2": Undo2, utensils: Utensils,
  wallet: Wallet, zap: Zap,
};

export function DynIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const I = (name && ICONS[name]) || Tag;
  return <I className={className} aria-hidden />;
}

/** Pastille d'icône colorée (catégorie, compte, objectif). */
export function IconBadge({ icon, color, size = "md" }: { icon: string | null | undefined; color?: string | null; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "size-7 rounded-lg [&_svg]:size-3.5", md: "size-9 rounded-xl [&_svg]:size-4", lg: "size-11 rounded-2xl [&_svg]:size-5" }[size];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${dims}`} style={{ backgroundColor: `${color ?? "#64748b"}1f`, color: color ?? "#64748b" }}>
      <DynIcon name={icon} />
    </span>
  );
}
