"use client";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";
import { REPORT_LABELS_CLIENT } from "./labels";

export function ReportPicker({ kind, months, years, current, yearly }: { kind: string; months: { value: string; label: string }[]; years: string[]; current: string; yearly: boolean }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap gap-2">
      <Select aria-label="Type de rapport" value={kind} onChange={(e) => router.replace(`/rapports?type=${e.target.value}`)} className="w-auto min-w-56">
        {Object.entries(REPORT_LABELS_CLIENT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      {yearly ? (
        <Select aria-label="Année" value={current} onChange={(e) => router.replace(`/rapports?type=${kind}&annee=${e.target.value}`)} className="w-auto">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      ) : (
        <Select aria-label="Mois" value={current} onChange={(e) => router.replace(`/rapports?type=${kind}&mois=${e.target.value}`)} className="w-auto capitalize">
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </Select>
      )}
    </div>
  );
}
