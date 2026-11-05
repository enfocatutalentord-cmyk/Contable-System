-- Bloque 8, entrega 8a: la aplicación del cliente (documento «Sistema Empire · Fase 2», secciones 2 y 4). Cualquiera crea su
-- cuenta desde la página de la firma y queda como prospecto; al firmar, la misma cuenta pasa a cliente con aplicación.

-- Estado «prospecto» en la ficha (relación con Empire) y cuándo se registró desde la aplicación.
ALTER TABLE empresas DROP CONSTRAINT empresas_estado_cliente_check;
ALTER TABLE empresas ADD CONSTRAINT empresas_estado_cliente_check
  CHECK (estado_cliente IN ('activo', 'en_cero', 'sin_operaciones', 'retirado', 'prospecto'));
ALTER TABLE empresas ADD COLUMN alta_app timestamptz;      -- se registró solo desde la aplicación
ALTER TABLE empresas ADD COLUMN paso_a_cliente timestamptz;

-- La firma decide si su página de registro está abierta (Clientes de la firma › Datos de la firma).
ALTER TABLE firmas ADD COLUMN alta_clientes boolean NOT NULL DEFAULT false;

-- Registros desde la página pública, para limitar los intentos por correo y por dirección (sin datos de la empresa).
CREATE TABLE altas_prospecto (
  id bigserial PRIMARY KEY,
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  email text NOT NULL,
  ip text,
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX altas_prospecto_idx ON altas_prospecto(creado);
-- Solo la conexión dueña la usa (página pública, sin sesión): contable_app no tiene acceso.

-- Roles base nuevos: prospecto (pide servicios, llena formularios, sube documentos) y cliente con aplicación.
CREATE OR REPLACE FUNCTION crear_perfiles_firma(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas) VALUES
    (fid, 'Administrador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','reabrir','adjuntar','exportar','auditoria','empresa','usuarios','impuestos'], true, false, NULL),
    (fid, 'Contador', ARRAY['ver','registrar','contabilizar','revertir','catalogo','cerrar','adjuntar','exportar','auditoria','impuestos'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/catalogo', '/cierres',
           '/diario', '/mayor', '/balanza', '/estados', '/reportes', '/dgii', '/fiscal', '/fiscal/impuestos', '/fiscal/retenciones', '/comprobantes',
           '/fiscal/probar', '/historial', '/empresa', '/configuracion']),
    (fid, 'Auxiliar', ARRAY['ver','registrar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/servicios', '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/asientos', '/bancos', '/diario', '/mayor',
           '/balanza', '/estados', '/reportes']),
    (fid, 'Coordinadora', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/recepcion', '/expediente', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes',
           '/cxc', '/cxc/estado', '/compras', '/pagos', '/proveedores', '/cxp', '/cxp/estado', '/dgii', '/reportes', '/empresa']),
    (fid, 'Facturación', ARRAY['ver','registrar','contabilizar','adjuntar','exportar'], true, false,
     ARRAY['', '/solicitudes', '/bitacora', '/notificaciones', '/facturas', '/igualas', '/recurrentes', '/propuestas', '/anticipos', '/cobros', '/clientes', '/servicios',
           '/cxc', '/cxc/estado', '/reportes']),
    (fid, 'Solo lectura', ARRAY['ver','exportar','auditoria'], true, false, NULL),
    (fid, 'Cliente · Consulta', ARRAY['ver','exportar'], true, true,
     ARRAY['', '/recepcion', '/facturas', '/cobros', '/anticipos', '/cxc', '/cxc/estado', '/compras', '/pagos', '/cxp', '/cxp/estado', '/reportes']),
    (fid, 'Cliente · Sube documentos', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/recepcion']),
    (fid, 'Cliente · Prospecto', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/solicitudes', '/recepcion']),
    (fid, 'Cliente · Con aplicación', ARRAY['ver','adjuntar','exportar'], true, true, ARRAY['', '/solicitudes', '/recepcion'])
  ON CONFLICT (firma_id, nombre) DO UPDATE
    SET permisos = EXCLUDED.permisos, pestanas = EXCLUDED.pestanas, para_clientes = EXCLUDED.para_clientes
    WHERE perfiles.sistema;
$$;

INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas)
SELECT id, 'Cliente · Prospecto', ARRAY['ver','adjuntar'], true, true, ARRAY['', '/solicitudes', '/recepcion'] FROM firmas
ON CONFLICT (firma_id, nombre) DO NOTHING;
INSERT INTO perfiles (firma_id, nombre, permisos, sistema, para_clientes, pestanas)
SELECT id, 'Cliente · Con aplicación', ARRAY['ver','adjuntar','exportar'], true, true, ARRAY['', '/solicitudes', '/recepcion'] FROM firmas
ON CONFLICT (firma_id, nombre) DO NOTHING;
