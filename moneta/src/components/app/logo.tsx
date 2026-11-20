import { APP_NAME } from "@/lib/utils";

export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-foreground" />
      <path d="M8 22V11.5l5 6 3-3.6 3 3.6 5-6V22" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="stroke-background" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[0.18em]">{APP_NAME}</span>
    </span>
  );
}
