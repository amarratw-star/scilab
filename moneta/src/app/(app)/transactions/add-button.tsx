"use client";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuickAdd } from "@/components/app/app-shell";

export function AddButton({ label = "Ajouter", preset }: { label?: string; preset?: Parameters<ReturnType<typeof useQuickAdd>>[0] }) {
  const open = useQuickAdd();
  return (
    <Button onClick={() => open(preset)}>
      <Plus /> {label}
    </Button>
  );
}
