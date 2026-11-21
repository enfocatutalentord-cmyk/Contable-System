-- Prioridad 2.2 (P2e.3, 21-nov-2026): el mensaje con el estado de cada trámite. Al cambiar su estado, el sistema arma el mensaje de WhatsApp para el
-- cliente (listo para enviar con un clic) y avisa a la firma mientras no se haya avisado el estado actual.

-- Último estado del que se le avisó al cliente (vacío = todavía no se le ha avisado nada).
ALTER TABLE tramites ADD COLUMN etapa_avisada text CHECK (etapa_avisada IS NULL OR etapa_avisada IN ('pendiente', 'en_proceso', 'en_espera', 'completado'));

-- Los trámites que ya existen no piden aviso retroactivo: se dan por avisados en el estado en que están.
UPDATE tramites SET etapa_avisada = etapa;

ALTER TABLE mensajes_enviados DROP CONSTRAINT mensajes_enviados_ref_tipo_check;
ALTER TABLE mensajes_enviados ADD CONSTRAINT mensajes_enviados_ref_tipo_check
  CHECK (ref_tipo IN ('factura', 'cobro', 'propuesta', 'notificacion', 'reporte', 'proyeccion', 'expediente', 'formulario', 'diagnostico', 'tramite'));

-- Mensaje predeterminado (Patricia lo revisa y lo edita en Mensajes predeterminados).
CREATE OR REPLACE FUNCTION crear_plantillas_mensaje_extra(fid uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO plantillas_mensaje (firma_id, clave, orden, nombre, texto)
  VALUES (fid, 'solicitud_servicio', 25, 'Solicitud de servicio',
          'Buenos días, [nombre]. Para atender su solicitud, complete este formulario con lo que necesita y para cuándo: [enlace]. Con eso le preparamos la cotización. -- Empire Tax & Legal'),
         (fid, 'requisitos_servicio', 26, 'Requisitos del servicio',
          E'Buenos días, [nombre]. Para avanzar con [servicio] necesitamos que nos envíe lo siguiente:\n[requisitos]\nEn cuanto lo tengamos, empezamos. -- Empire Tax & Legal'),
         (fid, 'estado_tramite', 27, 'Estado del trámite',
          'Buenos días, [nombre]. Le contamos cómo va su trámite «[trámite]»: [estado]. [detalle] Cualquier duda, con gusto le atendemos. -- Empire Tax & Legal'),
         (fid, 'correo_factura', 30, 'Correo: envío de factura',
          'Buenos días, [nombre]. Le compartimos su factura [número] por RD$[monto], que va adjunta en PDF. Agradecemos remitirnos el comprobante de pago respondiendo este correo.')
  ON CONFLICT (firma_id, clave) DO NOTHING;
$$;
SELECT crear_plantillas_mensaje_extra(id) FROM firmas;
