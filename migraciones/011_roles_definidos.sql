-- Roles base con sus permisos y restricciones (aprobado por Joannie el 29-oct-2026, «sí a todo, incluye Facturación»).
-- Criterio: quien prepara no aprueba (separación de funciones) y cada rol ve solo lo que necesita (mínimo privilegio).
-- Referentes: roles de QuickBooks Online (contador interno sin administración de usuarios) y de Xero (estándar,
-- solo facturación, solo lectura). Solo cambia los roles base; los roles propios de cada firma no se tocan.

CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    -- Contadora: aprueba, corrige, cierra y configura; no reabre períodos ni da accesos.
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/catalogo', '/cierres', '/diario', '/mayor', '/balanza', '/fiscal', '/fiscal/impuestos',
           '/fiscal/retenciones', '/comprobantes', '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    -- Auxiliar: prepara borradores y soportes; no emite, no contabiliza, no anula, no cierra ni configura.
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp',
           '/cxp/estado', '/asientos', '/diario', '/mayor', '/balanza']),
    -- Facturación (como «solo facturación» de Xero): factura y cobra; no ve compras, asientos, libros ni impuestos.
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/facturas', '/cobros', '/clientes', '/servicios', '/cxc', '/cxc/estado']),
    -- Solo lectura / auditor: ve todo y el historial; no cambia nada.
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/facturas', '/cobros', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado']),
    -- Sube documentos: su resumen y, con la parte 3, «Documentos»; no ve montos de compras.
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY[''])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;

SELECT crear_perfiles_firma(id) FROM firmas;
