export const metadata = { title: "Hors ligne" };
export default function Offline() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center p-6 text-center">
      <p className="text-xl font-semibold">Tu es hors ligne</p>
      <p className="mt-2 max-w-sm text-sm text-muted">Pour garantir des chiffres exacts, MONETA a besoin d&apos;une connexion pour afficher tes données. Réessaie dès que le réseau revient.</p>
    </div>
  );
}
