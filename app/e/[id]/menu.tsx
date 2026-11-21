"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FUERA_DEL_MENU, PESTANAS_ADMINISTRACION, PESTANAS_CLIENTE, PESTANAS_CONTABLES, PESTANAS_SOLO_PROPIA, puedeVer } from "@/lib/pestanas";

// Cómo se llaman las pestañas para el cliente en su aplicación (bloque 8a).
const NOMBRES_CLIENTE: Record<string, string> = {
  "": "Inicio", "/facturas-subidas": "Mis facturas", "/recepcion": "Mis documentos", "/solicitudes": "Mis solicitudes",
  // Rol «Cliente · Factura» (E3a): factura desde el sistema.
  "/facturas": "Facturar", "/clientes": "Mis clientes", "/servicios": "Mis productos y servicios", "/certificado": "Mi certificado",
};

type Clave = "firma" | "empire" | "talleres" | "administracion";
export const CLAVE_MENU = "menu-abiertos";

// Menú en cuatro secciones con desplegables (rediseño R1, «Lista de rediseños» de Patricia del 6-nov-2026): Firma (el trabajo a los
// clientes), Contabilidad (las empresas de la dueña, Prioridad 1.1 del prompt del 20-nov-2026), Talleres (reservada) y Administración.
// Cada sección muestra solo lo suyo y se abre sola la que tiene la pantalla en la que se está.
// pestanas: las que ve el rol de la persona en la empresa elegida (null = todas). soloCliente: usuario de una empresa cliente, que
// solo ve su aplicación. propias: las empresas de la dueña que la persona puede abrir (Empire es la que factura a los clientes).
// pestanasPropia: lo que la persona ve en Empire (false = sin acceso), para los cobros de Empire.
export type Propia = { id: string; nombre: string; empire: boolean };
export function Menu({ firmaId, empresaId, admin, auditoria, pestanas, soloCliente, propias = [], pestanasPropia = false, chatSinLeer = 0 }: {
  firmaId: string; empresaId: string | null; admin: boolean; auditoria: boolean; pestanas: string[] | null; soloCliente: boolean;
  propias?: Propia[]; pestanasPropia?: string[] | null | false; chatSinLeer?: number; // mensajes del chat del equipo sin leer (P2b)
}) {
  const ruta = usePathname();
  const firma = `/firma/${firmaId}`;
  const base = empresaId ? `/e/${empresaId}` : null;
  const propia = propias.find((p) => p.id === empresaId) ?? null; // la empresa propia abierta
  // Menú en dos niveles (Prioridad 1.4 del prompt de Patricia): todo empieza cerrado al entrar; lo que la persona abre se recuerda mientras
  // trabaja (en esa pestaña del navegador) y se borra al volver a entrar.
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setAbiertas(JSON.parse(sessionStorage.getItem(CLAVE_MENU) ?? "{}")); } catch { /* sin almacenamiento: queda cerrado */ }
  }, []);
  const alternar = (clave: string, abierta: boolean) => setAbiertas((a) => {
    if (!!a[clave] === abierta) return a;
    const nuevo = { ...a, [clave]: abierta };
    try { sessionStorage.setItem(CLAVE_MENU, JSON.stringify(nuevo)); } catch { /* sin almacenamiento */ }
    return nuevo;
  });
  const enPropia = !!propia;

  const deLaFirma: [string, string][] = [
    ...(admin ? [[`${firma}/clientes`, "Empresas Empire"], [`${firma}/equipo`, "Personas y accesos"], [`${firma}/perfiles`, "Roles y permisos"], [`${firma}/normas`, "Normas y tasas"]] as [string, string][] : []),
    [`${firma}/actividad`, "Actividad"],
  ];
  const visible = (r: string) => !FUERA_DEL_MENU.includes(r) && puedeVer(pestanas, r) && (r !== "/historial" || auditoria || !base);
  // Pestañas de un cliente, en Firma: sin lo que solo es de Empire (igualas, recurrentes, propuestas, lo de la socia). Usuarios e
  // historial de cambios van en Administración.
  const grupos = PESTANAS_CLIENTE.map((s) => ({
    ...s, enlaces: s.enlaces.filter(([r]) => !PESTANAS_ADMINISTRACION.includes(r) && !PESTANAS_SOLO_PROPIA.includes(r) && visible(r)
      && (base || !PESTANAS_CONTABLES.includes(r))), // sin cliente elegido no se sabe si lleva contabilidad: casi ninguno la lleva (R3)
  })).filter((s) => s.enlaces.length);
  // Pestañas de la empresa propia abierta, en Contabilidad debajo de su nombre (el acceso ya quitó lo que no le toca).
  const basePropia = propia ? `/e/${propia.id}` : null;
  const gruposPropia = !basePropia ? [] : PESTANAS_CLIENTE.map((s) => ({
    ...s, enlaces: s.enlaces.filter(([r]) => !PESTANAS_ADMINISTRACION.includes(r) && !FUERA_DEL_MENU.includes(r) && puedeVer(pestanas, r)),
  })).filter((s) => s.enlaces.length);
  const empire = propias.find((p) => p.empire) ?? null;
  // Prioridad 1.2: lo que debe cada cliente, a un clic, junto a los cobros de Empire.
  const deCobro: [string, string][] = [...(empire && puedeVer(pestanasPropia === false ? [] : pestanasPropia, "/cxc") ? [[`/e/${empire.id}/cxc`, "Lo que deben los clientes"]] as [string, string][] : []),
    [`${firma}/empire/tareas`, "Tareas de cobro"], [`${firma}/empire/mensajes`, "Mensajes de cobro"],
    ...(admin ? [[`${firma}/empire/presupuesto`, "Presupuesto"], [`${firma}/empire/cargo-aplicacion`, "Cargo por la aplicación"]] as [string, string][] : [])];
  const deEmpresa = PESTANAS_ADMINISTRACION.filter(visible);
  const todas = PESTANAS_CLIENTE.flatMap((s) => s.enlaces.map(([r]) => r));

  const activoFirma = (href: string) => (href === firma ? ruta === firma : ruta === href || ruta.startsWith(href + "/"));
  const activoEn = (b: string | null, r: string) => {
    if (!b) return false;
    const href = b + r;
    return r === "" ? ruta === b
      : ruta === href || (ruta.startsWith(href + "/") && !todas.some((o) => o.length > r.length && ruta.startsWith(b + o)));
  };
  const activoEmpresa = (r: string) => activoEn(base, r);
  const hrefEmpresa = (r: string) => (base ? base + r : `${firma}/elegir?a=${encodeURIComponent(r || "/")}`);
  const enlaceFirma = ([href, nombre]: [string, string]) => (
    <Link key={href} href={href} aria-current={activoFirma(href) ? "page" : undefined}>
      {nombre}{href === `${firma}/chat` && chatSinLeer > 0 && <> <span className="contador" aria-label={`${chatSinLeer} mensajes sin leer`}>{chatSinLeer}</span></>}
    </Link>
  );
  // Firma por trabajos (rediseño R4, n.º 2): se elige primero el trabajo y después el cliente. Lo de todos los clientes abre la
  // pantalla de la firma; lo de un cliente abre el cliente elegido arriba o pide elegirlo. Ya no hay un bloque del cliente con todo.
  const clienteElegido = base && !enPropia ? base : null;
  // Dentro de Empire no hay cliente elegido: se ofrecen las pestañas de un cliente cualquiera (sin contabilidad).
  const deCliente = new Set(enPropia
    ? PESTANAS_CLIENTE.flatMap((s) => s.enlaces.map(([r]) => r)).filter((r) => !PESTANAS_ADMINISTRACION.includes(r) && !PESTANAS_SOLO_PROPIA.includes(r)
      && !PESTANAS_CONTABLES.includes(r) && !FUERA_DEL_MENU.includes(r))
    : grupos.flatMap((s) => s.enlaces.map(([r]) => r)));
  const nombreDe = new Map(PESTANAS_CLIENTE.flatMap((s) => s.enlaces));
  type Trabajo = { firma: string; nombre: string } | { cliente: string; nombre?: string };
  const trabajos: [string, Trabajo[]][] = [
    ["Trabajo del mes", [{ firma, nombre: "Inicio de la firma" }, { firma: `${firma}/aprobaciones`, nombre: "Por aprobar" }, { firma: `${firma}/chat`, nombre: "Chat del equipo" }, { cliente: "", nombre: "Resumen del cliente" }, { firma: `${firma}/alertas`, nombre: "Alertas" }, { firma: `${firma}/agenda`, nombre: "Agenda de citas" },
      { firma: `${firma}/tareas`, nombre: "Tareas del mes" }, { firma: `${firma}/impuestos`, nombre: "Impuestos del mes" },
      { firma: `${firma}/reportes`, nombre: "Reportes del mes" }, { firma: `${firma}/bitacora`, nombre: "Bitácora de la firma" },
      { firma: `${firma}/mensajes`, nombre: "Mensajes predeterminados" }]],
    ["Facturas y documentos", [{ firma: `${firma}/documentos`, nombre: "Documentos recibidos" }, { firma: `${firma}/facturas-subidas`, nombre: "Facturas del cliente" },
    ]],
    ["Impuestos", [{ firma: `${firma}/calendario`, nombre: "Calendario fiscal" }, { cliente: "/dgii" }, { cliente: "/notificaciones" }, { cliente: "/comprobantes" }, { cliente: "/fiscal" }, { firma: `${firma}/firmantes`, nombre: "Firmantes de e-CF" },
      { cliente: "/fiscal/impuestos" }, { cliente: "/fiscal/retenciones" }, { cliente: "/fiscal/probar" }]],
    ["Reportes", [{ cliente: "/estados" }, { cliente: "/reportes" }, { firma: `${firma}/analisis`, nombre: "Análisis financiero" }, ...(admin ? [{ firma: `${firma}/rentabilidad`, nombre: "Rentabilidad por cliente" }] : [])]],
    ["Expediente y trámites", [{ firma: `${firma}/plantillas`, nombre: "Documentos y plantillas" }, { firma: `${firma}/firmas`, nombre: "Firma digital" }, { firma: `${firma}/tramites`, nombre: "Trámites abiertos" }, { firma: `${firma}/solicitudes`, nombre: "Solicitudes" },
      { cliente: "/expediente" }, { cliente: "/solicitudes" }, { cliente: "/recepcion" }, { cliente: "/bitacora", nombre: "Bitácora del cliente" }]],
    ["Laboral", [{ firma: `${firma}/laboral`, nombre: "Prestaciones laborales" }, { firma: `${firma}/nomina`, nombre: "Nómina y archivo TSS" }, { firma: `${firma}/cartas`, nombre: "Cartas de trabajo" }]],
    ["Auditoría", [{ firma: `${firma}/auditoria`, nombre: "Auditorías" }]],
    ["Vendario", [{ firma: `${firma}/vendario`, nombre: "Solicitudes y clientes" }, { firma: `${firma}/vendario/salud`, nombre: "Salud de la integración" }]],
  ];
  // Lo de un cliente que no tenga su lugar arriba (una pestaña nueva) no se pierde: va en «Otros».
  const ubicadas = new Set(trabajos.flatMap(([, t]) => t.map((x) => ("cliente" in x ? x.cliente : ""))));
  const otros = [...deCliente].filter((r) => !ubicadas.has(r) && r !== "/facturas-subidas").map((r) => ({ cliente: r }));
  if (otros.length) trabajos.push(["Otros", otros]);
  const enlacesTrabajos = trabajos.map(([grupo, lista]) => {
    const items = lista.filter((t) => !("cliente" in t) || deCliente.has(t.cliente));
    if (!items.length) return null;
    return (
      <details key={grupo} className="subseccion" open={!!abiertas[`g:${grupo}`]} onToggle={(e) => alternar(`g:${grupo}`, (e.currentTarget as HTMLDetailsElement).open)}>
        <summary>{grupo}{grupo === "Trabajo del mes" && chatSinLeer > 0 && <span className="contador" aria-label="mensajes sin leer">{chatSinLeer}</span>}</summary>
        <div className="subseccion-cuerpo">{items.map((t) => "firma" in t ? enlaceFirma([t.firma, t.nombre]) : (
          <Link key={t.cliente} href={clienteElegido ? clienteElegido + t.cliente : `${firma}/elegir?a=${encodeURIComponent(t.cliente || "/")}`}
            aria-current={clienteElegido && activoEmpresa(t.cliente) ? "page" : undefined}>{t.nombre ?? nombreDe.get(t.cliente) ?? t.cliente}</Link>
        ))}</div>
      </details>
    );
  });
  const enlacesEmpresa = (soloNombres = false) => grupos.map((s, i) => (
    <div key={i} className="subgrupo">
      {s.grupo && !soloNombres && <div className="grupo">{s.grupo === "Cliente elegido" && !base ? "De un cliente (se elige al abrir)" : s.grupo}</div>}
      {s.enlaces.map(([r, nombre]) => (
        <Link key={r} href={hrefEmpresa(r)} aria-current={activoEmpresa(r) ? "page" : undefined}>{soloNombres ? (NOMBRES_CLIENTE[r] ?? nombre) : nombre}</Link>
      ))}
    </div>
  ));
  const enlacesPropia = gruposPropia.map((s, i) => (
    <div key={i} className="subgrupo">
      {s.grupo && s.grupo !== "Cliente elegido" && <div className="grupo">{s.grupo === "Configuración del cliente" ? "Configuración" : s.grupo}</div>}
      {s.enlaces.map(([r, nombre]) => (
        <Link key={r} href={basePropia + r} aria-current={activoEn(basePropia, r) ? "page" : undefined}>
          {r === "" ? "Resumen" : nombre}
        </Link>
      ))}
    </div>
  ));

  // Sección donde está la pantalla abierta.
  const enAdmin = deLaFirma.some(([h]) => activoFirma(h)) || deEmpresa.some((r) => activoEmpresa(r));
  const actual: Clave = enAdmin ? "administracion"
    : enPropia || ruta.startsWith(`${firma}/empire`) || ruta.startsWith(`${firma}/contabilidad`) ? "empire" : "firma";

  if (soloCliente) return <>{enlacesEmpresa(true)}</>;

  const seccion = (clave: Clave, titulo: string, contenido: React.ReactNode) => (
    <details className="seccion" open={!!abiertas[`s:${clave}`]} onToggle={(e) => alternar(`s:${clave}`, (e.currentTarget as HTMLDetailsElement).open)}>
      <summary aria-current={actual === clave ? "true" : undefined}>{titulo}</summary>
      <div className="seccion-cuerpo">{contenido}</div>
    </details>
  );

  return (
    <>
      {seccion("firma", chatSinLeer > 0 ? `Firma (${chatSinLeer})` : "Firma", <>{enlacesTrabajos}</>)}
      {seccion("empire", "Contabilidad", <>
        {propias.map((p) => (
          <div key={p.id} className="subgrupo empresa-propia">
            <Link href={`/e/${p.id}`} className="nombre-propia" aria-current={ruta === `/e/${p.id}` ? "page" : undefined}>{p.nombre}</Link>
            {p.id === propia?.id && enlacesPropia}
            {p.empire && pestanasPropia !== false && (p.id === propia?.id || ruta.startsWith(`${firma}/empire`)) && (
              <div className="subgrupo">
                <div className="grupo">Cobros de Empire</div>
                {deCobro.map(enlaceFirma)}
              </div>
            )}
          </div>
        ))}
        {!propias.length && (
          <p className="nota-menu">
            {admin ? <>Todavía no están tus empresas. <Link href={`${firma}/contabilidad`}>Agregarlas</Link></>
              : "La contabilidad la ven quienes tienen acceso a ella."}
          </p>
        )}
        {admin && propias.length > 0 && enlaceFirma([`${firma}/contabilidad`, "Agregar o quitar empresas"])}
      </>)}
      {seccion("talleres", "Talleres", <p className="nota-menu">Próximamente. Se definen en una fase aparte.</p>)}
      {seccion("administracion", "Administración", <>
        {deLaFirma.map(enlaceFirma)}
        {deEmpresa.length > 0 && (
          <div className="subgrupo">
            <div className="grupo">{enPropia ? propia!.nombre : base ? "Cliente elegido" : "De un cliente"}</div>
            {deEmpresa.map((r) => (
              <Link key={r} href={hrefEmpresa(r)} aria-current={activoEmpresa(r) ? "page" : undefined}>
                {r === "/usuarios" ? "Usuarios y permisos" : r === "/empresa" ? (enPropia ? "Ficha de la empresa" : "Ficha del cliente") : "Historial de cambios"}
              </Link>
            ))}
          </div>
        )}
      </>)}
    </>
  );
}
