"use client";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markNotificationsReadAction } from "@/app/actions/finance";

export function MarkAllRead() {
  const router = useRouter();
  return <Button variant="outline" onClick={async () => { await markNotificationsReadAction(); router.refresh(); }}><CheckCheck /> Tout marquer comme lu</Button>;
}
