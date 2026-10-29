import { NextResponse, type NextRequest } from "next/server";

// Pasa la dirección pedida a las páginas de cada cliente, para revisar si el rol de la persona ve esa pestaña
// (lib/acceso.ts › accesoEmpresa). Los layouts no reciben la dirección; las páginas sí reciben este encabezado.
export function proxy(request: NextRequest) {
  const encabezados = new Headers(request.headers);
  encabezados.set("x-ruta", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: encabezados } });
}

export const config = { matcher: "/e/:path*" };
