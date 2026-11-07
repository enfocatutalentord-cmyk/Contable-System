import { Declaracion } from "../declaracion";
import { VolverAImpuestos } from "../volver";

export default async function Ir17({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string; desde?: string }> }) {
  const [{ id }, { mes, desde }] = await Promise.all([params, searchParams]);
  return <><VolverAImpuestos id={id} desde={desde} mes={mes} /><Declaracion id={id} formulario="IR-17" mes={mes} /></>;
}
