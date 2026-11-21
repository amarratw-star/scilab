"use client";
import { createContext, use } from "react";
import { setCurrencyResolver } from "@/lib/money";

/**
 * Devise d'affichage pour les composants client. formatMoney() la lit pendant le rendu via use(),
 * ce qui garantit le même résultat au rendu serveur (SSR) et dans le navigateur, sans état global partagé.
 * En dehors d'un rendu (gestionnaire d'événement), le résolveur renvoie undefined → repli sur l'euro.
 */
export const CurrencyContext = createContext<string>("EUR");

setCurrencyResolver(() => {
  try {
    return use(CurrencyContext);
  } catch {
    return undefined;
  }
});

export function CurrencyProvider({ currency, children }: { currency: string; children: React.ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  return use(CurrencyContext);
}
