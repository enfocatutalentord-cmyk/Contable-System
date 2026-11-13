-- Entrega E3a (propuesta «Los clientes emiten sus e-CF», «sí» de Patricia del 13-nov-2026): cada persona que firma tiene su propio
-- certificado, como define el «Instructivo Delegaciones de Roles» de la DGII (rol Firmante, delegado en personas físicas).
-- Nada cambia para lo que ya existe: el certificado de Empire queda como el de quien lo subió y como principal de la empresa.

-- Certificado por usuario: uno activo por persona y empresa. El principal es el que su dueño deja usar a los demás usuarios de su
-- empresa que no tienen uno propio (solo su dueño lo marca).
ALTER TABLE certificados_ecf ADD COLUMN usuario_id uuid REFERENCES usuarios(id), ADD COLUMN principal boolean NOT NULL DEFAULT false;
UPDATE certificados_ecf SET usuario_id = subido_por;
UPDATE certificados_ecf SET principal = true WHERE activo;
ALTER TABLE certificados_ecf ALTER COLUMN usuario_id SET NOT NULL;
DROP INDEX certificados_ecf_activo;
CREATE UNIQUE INDEX certificados_ecf_activo ON certificados_ecf(empresa_id, usuario_id) WHERE activo;
CREATE UNIQUE INDEX certificados_ecf_principal ON certificados_ecf(empresa_id) WHERE activo AND principal;

-- Cada XML firmado guarda con qué certificado se firmó y el nombre de su titular (quién lo hizo ya está en creado_por).
ALTER TABLE ecf_envios ADD COLUMN certificado_id uuid REFERENCES certificados_ecf(id), ADD COLUMN firmante text;
UPDATE ecf_envios v SET certificado_id = c.id, firmante = c.titular
  FROM certificados_ecf c WHERE c.empresa_id = v.empresa_id AND c.subido_en <= v.creado_en AND (c.retirado_en IS NULL OR c.retirado_en > v.creado_en);

-- Rol nuevo «Cliente · Factura»: el usuario del cliente hace sus facturas y notas de crédito, sus clientes y productos, y sube su
-- certificado («Mi certificado»). Anular un comprobante lo hace Empire (se revisa en la acción, aunque el rol tenga «revertir»,
-- que piden las notas de crédito).
CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/facturas-subidas', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres',
           '/diario', '/mayor', '/balanza', '/estados', '/reportes', '/dgii', '/fiscal', '/fiscal/impuestos', '/fiscal/retenciones', '/comprobantes',
           '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/facturas-subidas', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor',
           '/balanza', '/estados', '/reportes']),
    (fid, 'Coordinadora', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/facturas-subidas', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/dgii', '/reportes', '/empresa']),
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes', '/servicios',
           '/cxc', '/cxc/estado', '/reportes']),
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true, ARRAY['', '/facturas-subidas', '/solicitudes', '/recepcion']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/facturas-subidas', '/solicitudes', '/recepcion']),
    (fid, 'Cliente · Prospecto', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/solicitudes', '/recepcion']),
    (fid, 'Cliente · Con aplicación', ARRAY['ver','adjuntar','exportar'], true, true, ARRAY['', '/facturas-subidas', '/solicitudes', '/recepcion']),
    (fid, 'Cliente · Factura', ARRAY['ver','registrar','contabilizar','revertir','adjuntar','exportar'], true, true,
     ARRAY['', '/facturas', '/clientes', '/servicios', '/certificado', '/facturas-subidas', '/solicitudes', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;

-- En las firmas que ya existen solo se agrega el rol nuevo (los demás roles se quedan como cada firma los tenga).
INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas)
SELECT id, 'Cliente · Factura', ARRAY['ver','registrar','contabilizar','revertir','adjuntar','exportar'], true, true,
       ARRAY['', '/facturas', '/clientes', '/servicios', '/certificado', '/facturas-subidas', '/solicitudes', '/recepcion'] FROM firmas
ON CONFLICT (firma_id, nombre) DO NOTHING;
