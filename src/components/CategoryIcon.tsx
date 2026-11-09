import {
  ArrowLeftRight,
  Banknote,
  Briefcase,
  Car,
  CircleHelp,
  Coffee,
  Film,
  GraduationCap,
  HeartPulse,
  Home,
  Plane,
  Repeat,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Undo2,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight,
  Banknote,
  Briefcase,
  Car,
  CircleHelp,
  Coffee,
  Film,
  GraduationCap,
  HeartPulse,
  Home,
  Plane,
  Repeat,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Undo2,
  UtensilsCrossed,
  Zap,
};

export const ICON_NAMES = Object.keys(ICONS).sort();

export function CategoryIcon({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  const Icon = (name && ICONS[name]) || CircleHelp;
  return <Icon className={className} />;
}
