"use client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { useEffect } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <Toaster position="top-center" richColors closeButton toastOptions={{ className: "!rounded-2xl !font-sans" }} />
    </ThemeProvider>
  );
}
