import { Declaracion } from "../declaracion";

export default async function Ir17({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const [{ id }, { mes }] = await Promise.all([params, searchParams]);
  return <Declaracion id={id} formulario="IR-17" mes={mes} />;
}
