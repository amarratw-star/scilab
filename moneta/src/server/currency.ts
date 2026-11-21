import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { setCurrencyResolver } from "@/lib/money";

/**
 * Devise d'affichage par requête :
 *  - rendu des Server Components : stockage par requête via React cache ;
 *  - routes API / actions : withCurrency() (AsyncLocalStorage).
 */
const requestStore = cache(() => ({ code: undefined as string | undefined }));
const als = new AsyncLocalStorage<{ code: string }>();

setCurrencyResolver(() => als.getStore()?.code ?? requestStore().code);

export function setRequestCurrency(code: string) {
  requestStore().code = code;
}

export function withCurrency<T>(code: string, fn: () => T): T {
  return als.run({ code }, fn);
}
