-- Bloque 4, entrega 4a (Sistema Empire, «sí» de Patricia del 5-nov-2026): impuestos del mes por cliente (Fase 2, sección 5).
-- Al presentar una declaración se guarda su constancia, el monto a pagar y la fecha límite; con monto, nace sola la notificación
-- de pago de la DGII (para enviarla por WhatsApp y vigilarla en las alertas). Cada compra se puede marcar como revisada.

ALTER TABLE envios_dgii
  ADD COLUMN constancia_id uuid REFERENCES documentos(id) ON DELETE SET NULL,
  ADD COLUMN monto_pagar numeric(18,2) CHECK (monto_pagar >= 0),
  ADD COLUMN fecha_limite date,
  ADD COLUMN notificacion_id uuid REFERENCES notificaciones_pago(id) ON DELETE SET NULL;

-- La constancia de una declaración sin monto a pagar queda como documento de la declaración.
ALTER TABLE documentos DROP CONSTRAINT documentos_entidad_check;
ALTER TABLE documentos ADD CONSTRAINT documentos_entidad_check
  CHECK (entidad IN ('asiento', 'factura', 'cobro', 'compra', 'pago', 'empresa', 'notificacion', 'gestion', 'declaracion'));

-- ───── Revisión de compras ─────
-- Quién revisó cada compra registrada (clasificación del 606, bien o servicio, ITBIS con o sin crédito, retenciones) y cuándo.
-- «corregir» deja una nota: la compra se corrige como siempre (anulándola o con nota de crédito) y se vuelve a revisar.
CREATE TABLE revisiones_compra (
  compra_id uuid PRIMARY KEY REFERENCES compras(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  estado text NOT NULL CHECK (estado IN ('revisada', 'corregir')),
  nota text CHECK (length(nota) <= 500),
  revisada_por uuid NOT NULL REFERENCES usuarios(id),
  revisada_en timestamptz NOT NULL DEFAULT now(),
  CHECK (estado = 'revisada' OR length(btrim(coalesce(nota, ''))) > 0)
);
ALTER TABLE revisiones_compra ENABLE ROW LEVEL SECURITY;
ALTER TABLE revisiones_compra FORCE ROW LEVEL SECURITY;
CREATE POLICY revisiones_compra_empresa ON revisiones_compra USING (empresa_id = empresa_actual()) WITH CHECK (empresa_id = empresa_actual());
GRANT SELECT, INSERT, UPDATE, DELETE ON revisiones_compra TO contable_app;
CREATE TRIGGER z_auditar AFTER INSERT OR UPDATE OR DELETE ON revisiones_compra FOR EACH ROW EXECUTE FUNCTION auditar();
CREATE TRIGGER revisiones_compra_referencias BEFORE INSERT OR UPDATE ON revisiones_compra FOR EACH ROW
  EXECUTE FUNCTION validar_referencias_empresa('compras.compra_id');
