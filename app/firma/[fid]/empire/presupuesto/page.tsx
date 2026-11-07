import Link from "next/link";
import { accesoFirma } from "@/lib/acceso";

export const metadata = { title: "Presupuesto · Empire Tax’N Legal" };

// Contabilidad Empire (rediseño R2, n.º 5 de la lista): el lugar del presupuesto de la oficina y del personal. Se arma con el Excel
// PRESUPUESTO 2026 (entregas 7b y 7c, propuestas el 5-nov-2026). Solo para administradores: el presupuesto personal es privado.
export default async function Presupuesto({ params }: { params: Promise<{ fid: string }> }) {
  const { fid } = await params;
  const { firma } = await accesoFirma(fid);
  return (
    <>
      <h1>Presupuesto</h1>
      <p className="sub">El presupuesto de la oficina y el presupuesto personal de la socia, mes por mes, contra lo que de verdad se pagó.</p>
      <div className="tarjeta" style={{ maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Llega con el Excel PRESUPUESTO 2026</h2>
        <p>
          Para armarlo como lo lleva Patricia hace falta su Excel «PRESUPUESTO 2026» (partidas, montos por mes y metas de ahorro).
          Mientras tanto, las salidas de la oficina y las personales se registran en{" "}
          {firma.empresa_propia_id ? <Link href={`/e/${firma.empresa_propia_id}/salidas`}>Registrar salidas</Link> : "Registrar salidas"} y
          se ven en la Cuenta de la socia.
        </p>
      </div>
    </>
  );
}
