"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const OPTIONS = [
  { value: "mois", label: "Ce mois" },
  { value: "mois-precedent", label: "Mois précédent" },
  { value: "3m", label: "3 mois" },
  { value: "6m", label: "6 mois" },
  { value: "12m", label: "12 mois" },
  { value: "annee", label: "Cette année" },
  { value: "annee-precedente", label: "Année précédente" },
  { value: "perso", label: "Dates…" },
];

export function AnalysisPeriod({ value, from, to }: { value: string; from: string; to: string }) {
  const router = useRouter();
  const [du, setDu] = useState(from);
  const [au, setAu] = useState(to);
  return (
    <div className="flex flex-col gap-2">
      <Segmented value={value} onChange={(v) => router.replace(v === "perso" ? `/analyses?periode=perso&du=${du}&au=${au}` : `/analyses?periode=${v}`, { scroll: false })} options={OPTIONS} />
      {value === "perso" && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); router.replace(`/analyses?periode=perso&du=${du}&au=${au}`); }}>
          <Input type="date" className="w-auto" value={du} onChange={(e) => setDu(e.target.value)} aria-label="Du" />
          <Input type="date" className="w-auto" value={au} onChange={(e) => setAu(e.target.value)} aria-label="Au" />
          <Button variant="secondary" type="submit">Appliquer</Button>
        </form>
      )}
    </div>
  );
}
