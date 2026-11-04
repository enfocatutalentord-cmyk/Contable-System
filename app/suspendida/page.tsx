import { exigirUsuario } from "@/lib/auth";
import { contactoPlataforma } from "@/lib/plataforma";
import { salir } from "../acciones-cuenta";

export const metadata = { title: "Firma suspendida · Empire Tax’N Legal" };

// Aviso para quien entra a una firma suspendida desde la Consola de la plataforma.
export default async function Suspendida() {
  await exigirUsuario();
  const correo = await contactoPlataforma();
  return (
    <main className="centro">
      <div className="tarjeta" style={{ maxWidth: 520 }}>
        <h1>Firma suspendida</h1>
        <p>El acceso a esta firma está suspendido por ahora. Sus datos se conservan y no se ha borrado nada.</p>
        {correo && <p>Para más información escribe a <a href={`mailto:${correo}`}>{correo}</a>.</p>}
        <form action={salir}><button>Salir</button></form>
      </div>
    </main>
  );
}
