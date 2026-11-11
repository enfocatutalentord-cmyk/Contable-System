-- Factura electrónica, entrega E2a («sí» de Patricia del 11-nov-2026): Empire emite con su propio sistema. Esta entrega guarda el
-- certificado cifrado, arma y firma el XML de E31, E32 y E34 y prueba la conexión con la DGII. El envío real llega cuando la DGII
-- acepte la conexión del servidor (sus servicios rechazan conexiones desde fuera del país; se está consultando).

-- Ambiente de la DGII con el que trabaja la empresa: pre-certificación, certificación o producción.
ALTER TABLE empresas ADD COLUMN ecf_ambiente text CHECK (ecf_ambiente IN ('testecf', 'certecf', 'ecf'));

-- Certificado digital (.p12) de la persona que firma. El archivo y su contraseña se guardan cifrados (AES-256-GCM) con una llave
-- que está en Vercel (ECF_LLAVE), fuera de la base. No hay forma de descargarlo. Uno activo por empresa.
CREATE TABLE certificados_ecf (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  archivo bytea NOT NULL,          -- .p12 cifrado
  clave bytea NOT NULL,            -- contraseña cifrada
  titular text NOT NULL,           -- nombre del certificado (CN)
  identificacion text,             -- campo SN: RNC, cédula o pasaporte del titular
  emisor text,                     -- entidad de certificación
  valido_desde date NOT NULL,
  vence date NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  subido_por uuid NOT NULL REFERENCES usuarios(id),
  subido_en timestamptz NOT NULL DEFAULT now(),
  retirado_por uuid REFERENCES usuarios(id),
  retirado_en timestamptz
);
CREATE UNIQUE INDEX certificados_ecf_activo ON certificados_ecf(empresa_id) WHERE activo;
ALTER TABLE certificados_ecf ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificados_ecf FORCE ROW LEVEL SECURITY;
CREATE POLICY certificados_ecf_empresa ON certificados_ecf USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON certificados_ecf TO contable_app;

-- Cada XML firmado y, cuando haya conexión, su envío a la DGII y el resultado.
CREATE TABLE ecf_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  factura_id uuid NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  ambiente text NOT NULL CHECK (ambiente IN ('testecf', 'certecf', 'ecf')),
  encf text NOT NULL CHECK (encf ~ '^E\d{12}$'),
  prueba boolean NOT NULL,         -- XML de prueba: no tomó número del rango ni emitió la factura
  xml text NOT NULL,
  codigo_seguridad text NOT NULL,
  fecha_firma text NOT NULL,       -- dd-MM-AAAA HH:mm:ss, como va en el XML y en el QR
  track_id text,
  estado text NOT NULL DEFAULT 'firmado'
    CHECK (estado IN ('firmado', 'enviado', 'en_proceso', 'aceptado', 'aceptado_condicional', 'rechazado', 'error')),
  secuencia_utilizada boolean,
  mensajes jsonb NOT NULL DEFAULT '[]',
  creado_por uuid NOT NULL REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz
);
CREATE INDEX ecf_envios_factura ON ecf_envios(empresa_id, factura_id, creado_en DESC);
ALTER TABLE ecf_envios ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecf_envios FORCE ROW LEVEL SECURITY;
CREATE POLICY ecf_envios_empresa ON ecf_envios USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE ON ecf_envios TO contable_app;
