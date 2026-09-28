import Image from "next/image";
import { HERO } from "@/lib/assets";

/** Marco de ingreso/registro: formulario + panel con arte de LU4. */
export function AuthShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-gold/20 bg-surface/60 lg:grid-cols-2">
      <div className="relative hidden min-h-[560px] lg:block">
        <Image src={HERO.imageSm} alt="" fill sizes="50vw" className="object-cover object-[75%_center]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(10_9_16/0.95),rgb(10_9_16/0.2)_60%)]" />
        <div className="absolute inset-x-0 bottom-0 p-8">
          <p className="text-xs font-semibold tracking-[0.25em] text-gold uppercase">Lineage 2 · LU4</p>
          <p className="mt-2 font-display text-2xl font-bold">{title}</p>
          <p className="mt-1 text-sm text-ink/75">{subtitle}</p>
        </div>
      </div>
      <div className="p-6 sm:p-10">{children}</div>
    </div>
  );
}
