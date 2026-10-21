import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/auth";

export default async function Inicio() {
  redirect((await usuarioActual()) ? "/empresas" : "/entrar");
}
