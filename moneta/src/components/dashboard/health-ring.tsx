import { cn } from "@/lib/utils";

/** Jauge circulaire de la note de santé financière (SVG, compatible thèmes clair/sombre). */
export function HealthRing({ score, size = 112, label }: { score: number | null; size?: number; label?: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = score === null ? "var(--subtle)" : score >= 65 ? "var(--positive)" : score >= 50 ? "var(--info)" : score >= 35 ? "var(--warning)" : "var(--negative)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={score === null ? "Note indisponible" : `Note de santé financière : ${score} sur 100`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("amount-hero", size > 100 ? "text-3xl" : "text-xl")}>{score ?? "—"}</span>
        <span className="text-[10px] text-subtle">{label ?? "/ 100"}</span>
      </div>
    </div>
  );
}
