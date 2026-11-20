-- Prioridad 2.1 (P2a, parte 2): aprobación de acciones con sus datos guardados. Además de los borradores (facturas y compras), lo que una
-- persona hace con un permiso «con aprobación» —registrar una salida, anular, cerrar, presentar una declaración, revisar el reporte— se guarda
-- tal cual con sus datos y se ejecuta cuando alguien con «aprobar» lo aprueba.

ALTER TABLE aprobaciones DROP CONSTRAINT aprobaciones_tipo_check;
ALTER TABLE aprobaciones ADD CONSTRAINT aprobaciones_tipo_check CHECK (tipo IN ('factura', 'compra', 'accion'));
ALTER TABLE aprobaciones DROP CONSTRAINT aprobaciones_estado_check;
ALTER TABLE aprobaciones ADD CONSTRAINT aprobaciones_estado_check CHECK (estado IN ('pendiente', 'devuelta', 'aprobada', 'cancelada'));
ALTER TABLE aprobaciones ADD COLUMN payload jsonb;   -- {accion, args, campos}: lo que se ejecuta al aprobar (solo tipo «accion»)
ALTER TABLE aprobaciones ADD CONSTRAINT aprobaciones_payload_check CHECK ((tipo = 'accion') = (payload IS NOT NULL));

ALTER TABLE aprobaciones_eventos DROP CONSTRAINT aprobaciones_eventos_evento_check;
ALTER TABLE aprobaciones_eventos ADD CONSTRAINT aprobaciones_eventos_evento_check CHECK (evento IN ('solicitada', 'devuelta', 'reenviada', 'aprobada', 'cancelada'));
