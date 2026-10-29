import { Declaracion } from "../declaracion";

export default async function It1({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const [{ id }, { mes }] = await Promise.all([params, searchParams]);
  return <Declaracion id={id} formulario="IT-1" mes={mes} />;
}
