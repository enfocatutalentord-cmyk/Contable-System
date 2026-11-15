-- Integración con Vendario, parte 3: cuadre mensual (acuerdo, sección 10). Empire consulta a Vendario (empire-ledger) los totales de un
-- rango y los compara con lo recibido. Cada consulta queda guardada con lo que respondió Vendario y la comparación.
CREATE TABLE vendario_cuadres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendario_cliente_id uuid NOT NULL REFERENCES vendario_clientes(id) ON DELETE CASCADE,
  desde date NOT NULL,
  hasta date NOT NULL,
  respuesta jsonb,                 -- lo que respondió Vendario, tal cual
  comparacion jsonb,               -- por evento, por cuenta, faltantes y sobrantes
  cuadra boolean,
  error text,                      -- si la consulta falló
  consultado_por uuid REFERENCES usuarios(id),
  consultado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendario_cuadres_cliente ON vendario_cuadres (vendario_cliente_id, desde, consultado_en DESC);
REVOKE ALL ON vendario_cuadres FROM PUBLIC;
