-- Prioridad 2.2 (P2b, 21-nov-2026): chat interno del equipo y rentabilidad por cliente.
--
-- Chat: conversaciones del equipo de la firma, ligadas a un cliente o a un trabajo (una solicitud) o generales. No salen correos ni WhatsApp;
-- el aviso es un número en el menú. Tablas de la firma, sin RLS y siempre filtradas por firma_id (como plantillas_tarea); la pantalla revisa
-- además que la persona vea ese cliente. Los mensajes no se editan ni se borran (queda el historial).
-- Rentabilidad: tiempo anotado en la bitácora (minutos) por el costo de la hora que pone la dueña.

CREATE TABLE chat_mensajes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  -- 'general', 'c:<empresa>' (un cliente) o 't:<empresa>:<solicitud>' (un trabajo de un cliente)
  hilo text NOT NULL,
  empresa_id uuid REFERENCES empresas(id) ON DELETE CASCADE,
  solicitud_id uuid REFERENCES solicitudes(id) ON DELETE CASCADE,
  autor_id uuid NOT NULL REFERENCES usuarios(id),
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 2000),
  creado timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_hilo_check CHECK (
    (empresa_id IS NULL AND solicitud_id IS NULL AND hilo = 'general')
    OR (empresa_id IS NOT NULL AND solicitud_id IS NULL AND hilo = 'c:' || empresa_id::text)
    OR (empresa_id IS NOT NULL AND solicitud_id IS NOT NULL AND hilo = 't:' || empresa_id::text || ':' || solicitud_id::text))
);
CREATE INDEX chat_mensajes_hilo_idx ON chat_mensajes(firma_id, hilo, creado);
CREATE INDEX chat_mensajes_empresa_idx ON chat_mensajes(firma_id, empresa_id, creado DESC);

-- Hasta dónde leyó cada persona cada conversación (sin fila: nada leído).
CREATE TABLE chat_lecturas (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  hilo text NOT NULL,
  leido_hasta timestamptz NOT NULL,
  PRIMARY KEY (usuario_id, firma_id, hilo)
);

-- Tiempo dedicado a cada gestión (opcional) y costo de la hora de trabajo de la firma.
ALTER TABLE gestiones ADD COLUMN minutos integer CHECK (minutos IS NULL OR minutos BETWEEN 1 AND 1440);
ALTER TABLE firmas ADD COLUMN costo_hora numeric(18,2) CHECK (costo_hora IS NULL OR (costo_hora >= 0 AND costo_hora <= 100000));
