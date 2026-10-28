-- Inicio de la firma (28-oct-2026, pedido de Joannie: ver todos los clientes y el trabajo del equipo en una sola pantalla).
-- Cada cliente puede tener una persona del equipo responsable; se muestra en «Inicio de la firma» y en «Clientes».
ALTER TABLE empresas ADD COLUMN responsable_id uuid REFERENCES usuarios(id) ON DELETE SET NULL;
