// Franja que solo sale en las vistas previas de Vercel: su base no tiene los datos reales ni las migraciones, y no envía correos.
// Sin ella se confunden con el sistema real (10-nov-2026: alguien intentó crear su cuenta y recuperar la contraseña en una).
export function AvisoVistaPrevia() {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const real = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "contable-system.vercel.app"}`;
  return (
    <div className="franja-vista-previa" role="alert">
      <strong>Esta es una vista previa de prueba, no el sistema real.</strong> No tiene los datos reales, no envía correos y aquí
      pueden fallar la entrada y el registro. <a href={real}>Ir al sistema real</a>
    </div>
  );
}
