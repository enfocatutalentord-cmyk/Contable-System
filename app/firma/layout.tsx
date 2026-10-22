import { BarraMarca } from "../marca";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BarraMarca />
      {children}
    </>
  );
}
