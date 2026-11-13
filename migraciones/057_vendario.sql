-- Integración con Vendario (punto de venta e inventario), acuerdo v1.0 del 13-nov-2026 (docs/vendario/acuerdo.md). Parte 1:
-- recepción firmada, ciclo del cliente (alta, cambios, baja), estados que Empire manda a Vendario con reintentos y salud.
-- Estas tablas son de la plataforma, no de una empresa: solo las usa el servidor con la conexión dueña (no se dan al rol de la app).

-- La firma que recibe los clientes de Vendario (una sola). La marca un administrador en Firma › Vendario.
ALTER TABLE firmas ADD COLUMN recibe_vendario boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX firmas_recibe_vendario ON firmas ((true)) WHERE recibe_vendario;

-- Cada mensaje tal como llegó (cuerpo exacto y sobre), sin repetir el id. Se procesa después de responder.
CREATE TABLE vendario_mensajes (
  id uuid PRIMARY KEY,                       -- id del sobre
  tipo text NOT NULL,
  org_id text NOT NULL,                      -- org.vendario_id
  org_rnc text,
  seq bigint,
  creado_en_vendario timestamptz,
  cuerpo text NOT NULL,                      -- tal como llegó (lo que se firmó)
  sobre jsonb NOT NULL,
  recibido_en timestamptz NOT NULL DEFAULT now(),
  estado text NOT NULL DEFAULT 'recibido' CHECK (estado IN ('recibido', 'procesado', 'pendiente', 'error')),
  motivo text,
  intentos int NOT NULL DEFAULT 0,
  procesado_en timestamptz
);
CREATE INDEX vendario_mensajes_recibido ON vendario_mensajes (recibido_en DESC);
CREATE INDEX vendario_mensajes_por_procesar ON vendario_mensajes (recibido_en) WHERE estado IN ('recibido', 'pendiente');

-- Intentos rechazados (firma u hora inválida, cuerpo ilegible): para la salud de la integración. No se guarda el cuerpo.
CREATE TABLE vendario_rechazos (
  id bigserial PRIMARY KEY,
  recibido_en timestamptz NOT NULL DEFAULT now(),
  codigo int NOT NULL,
  motivo text NOT NULL,
  ip text,
  largo int
);

-- Cada empresa de Vendario que pidió el servicio: la solicitud, su autorización y su estado en Empire.
CREATE TABLE vendario_clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firma_id uuid NOT NULL REFERENCES firmas(id) ON DELETE CASCADE,
  org_id text NOT NULL UNIQUE,               -- vendario_id
  rnc text,                                  -- org.rnc tal como llegó (va en cada sobre de vuelta)
  empresa_id uuid REFERENCES empresas(id) ON DELETE SET NULL,
  estado text NOT NULL DEFAULT 'solicitud'
    CHECK (estado IN ('solicitud', 'aceptada', 'necesita_info', 'suspendida', 'finalizada')),
  servicios text[] NOT NULL,
  fecha_inicio date,
  historico_desde date,
  historico_hasta date,
  empresa_datos jsonb NOT NULL DEFAULT '{}',
  contacto jsonb NOT NULL DEFAULT '{}',
  autorizacion jsonb NOT NULL DEFAULT '{}',
  responsable_id uuid REFERENCES usuarios(id),
  vista_por uuid REFERENCES usuarios(id),
  vista_en timestamptz,
  aceptada_por uuid REFERENCES usuarios(id),
  aceptada_en timestamptz,
  nota text,                                 -- última nota enviada (necesita_info o suspendida)
  al_dia_hasta text CHECK (al_dia_hasta ~ '^\d{4}-\d{2}$'),
  historico_totales jsonb,                   -- sync.history_complete
  historico_completo_en timestamptz,
  baja_en timestamptz,
  baja_motivo text,
  alta_mensaje_id uuid,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendario_clientes_firma ON vendario_clientes (firma_id, estado);

-- Eventos contables recibidos, por cliente. En la parte 1 se guardan; la parte 2 los contabiliza.
CREATE TABLE vendario_eventos (
  id uuid PRIMARY KEY,                       -- id del sobre
  vendario_cliente_id uuid NOT NULL REFERENCES vendario_clientes(id) ON DELETE CASCADE,
  seq bigint,
  tipo text NOT NULL,                        -- event_type
  fecha date,
  historico boolean NOT NULL DEFAULT false,
  revierte uuid,                             -- reverses
  total numeric(18,2),
  datos jsonb NOT NULL,
  recibido_en timestamptz NOT NULL DEFAULT now(),
  estado text NOT NULL DEFAULT 'esperando'
    CHECK (estado IN ('esperando', 'contabilizado', 'pendiente', 'despues_de_baja', 'descartado')),
  motivo text,
  procesado_en timestamptz
);
CREATE INDEX vendario_eventos_cliente ON vendario_eventos (vendario_cliente_id, seq);
CREATE INDEX vendario_eventos_fecha ON vendario_eventos (vendario_cliente_id, fecha);

-- Lo que Empire manda a Vendario (estados), con sus intentos. Un 422 no se reintenta; un 401 tampoco (avisa).
CREATE TABLE vendario_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- id del sobre que se manda
  vendario_cliente_id uuid NOT NULL REFERENCES vendario_clientes(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'service.status',
  estado_servicio text NOT NULL,             -- data.status
  sobre jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'fallido', 'rechazado')),
  intentos int NOT NULL DEFAULT 0,
  proximo_intento timestamptz NOT NULL DEFAULT now(),
  codigo int,
  respuesta text,
  creado_por uuid REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  enviado_en timestamptz
);
CREATE INDEX vendario_envios_cliente ON vendario_envios (vendario_cliente_id, creado_en DESC);
CREATE INDEX vendario_envios_por_enviar ON vendario_envios (proximo_intento) WHERE estado = 'pendiente';

REVOKE ALL ON vendario_mensajes, vendario_rechazos, vendario_clientes, vendario_eventos, vendario_envios FROM PUBLIC;
