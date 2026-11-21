import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/connexion", "/inscription", "/mot-de-passe-oublie", "/reinitialiser", "/confidentialite", "/hors-ligne", "/api/cron", "/api/webhooks", "/confidentialite-bancaire"];

/**
 * Filtre de premier niveau : sans cookie de session, redirection vers la connexion.
 * La validation réelle de la session (base de données) est faite côté serveur par requireUser().
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!req.cookies.has("moneta_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = pathname !== "/" ? `?suite=${encodeURIComponent(pathname + search)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|icon.svg|manifest.webmanifest|sw.js|favicon.ico|robots.txt).*)"],
};
