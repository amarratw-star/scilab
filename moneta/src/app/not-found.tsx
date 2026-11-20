import Link from "next/link";
export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center p-6 text-center">
      <p className="text-5xl font-semibold tracking-tight">404</p>
      <p className="mt-2 text-muted">Cette page n&apos;existe pas (ou plus).</p>
      <Link href="/" className="mt-6 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Retour au tableau de bord</Link>
    </div>
  );
}
