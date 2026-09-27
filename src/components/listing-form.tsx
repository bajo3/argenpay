"use client";
import { useState } from "react";
import { computeOrderAmounts, type ProcessorFeePolicy } from "@/lib/fees";
import { CLASSES, RACES } from "@/lib/lu4";
import { formatARS, parseARSToCents } from "@/lib/money";
import { SubmitButton } from "./submit-button";

interface CategoryOption { id: string; slug: string; name: string; unit_label: string; unit_label_plural: string }
interface Props {
  action: (fd: FormData) => Promise<void>;
  servers: { id: string; name: string }[];
  categories: CategoryOption[];
  fees: { commissionBps: number; processorFeeBps: number; processorFeePolicy: ProcessorFeePolicy };
  /** Categoría fija (páginas "Publicar cuenta/adena/ítem/servicio"). */
  fixedCategoryId?: string;
  /** Página a la que se vuelve si hay un error de validación. */
  backPath?: string;
  initial?: {
    id: string; title: string; description: string; conditions: string; price: string; stock: number; min_quantity: number;
    delivery_time_hours: number; server_id: string | null; category_id: string;
    char_race: string | null; char_class: string | null; char_level: number | null;
  };
}

const PLACEHOLDERS: Record<string, { title: string; description: string }> = {
  adena: { title: "Adena Carmine · entrega rápida por trade", description: "Entrego por trade en Giran o por correo. Horario: 10 a 24 h (ARG). Indicá tu nick al comprar." },
  cuentas: { title: "Archmage 76 · full A · con subclase", description: "Detalle de equipo, skills, quests hechas, clan, estado de la cuenta y cómo se transfiere." },
  items: { title: "Arma A grado +6", description: "Nombre exacto del ítem, encantamiento, SA, cantidad y forma de entrega." },
  servicios: { title: "Leveo 40→61 en 3 días", description: "Qué incluye el servicio, horarios, requisitos y qué necesitás darme." },
};

export function ListingForm({ action, servers, categories, fees, initial, fixedCategoryId, backPath }: Props) {
  const [categoryId, setCategoryId] = useState(fixedCategoryId ?? initial?.category_id ?? categories[0]?.id ?? "");
  const [price, setPrice] = useState(initial?.price ?? "");
  const category = categories.find((c) => c.id === categoryId);
  const slug = category?.slug ?? "adena";
  const unit = category?.unit_label ?? "unidad";
  const plural = category?.unit_label_plural ?? "unidades";
  const cents = parseARSToCents(price);
  const quote = cents && cents >= 100 ? computeOrderAmounts({ unitPriceCents: cents, quantity: 1, ...fees }) : null;
  const ph = PLACEHOLDERS[slug] ?? PLACEHOLDERS.adena;

  return (
    <form action={action} className="space-y-6">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      {backPath && <input type="hidden" name="back" value={backPath} />}

      <section className="card space-y-4">
        <h2 className="h2">{fixedCategoryId ? "Servidor" : "¿Qué vendés?"}</h2>
        {fixedCategoryId && <input type="hidden" name="category_id" value={fixedCategoryId} />}
        <div className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${fixedCategoryId ? "hidden" : ""}`}>
          {categories.map((c) => (
            <label key={c.id} className={`chip cursor-pointer justify-center py-2.5 ${categoryId === c.id ? "chip-active" : ""}`}>
              <input type="radio" name="category_id" value={c.id} checked={categoryId === c.id} onChange={() => setCategoryId(c.id)} className="sr-only" />
              {c.name}
            </label>
          ))}
        </div>
        <div>
          <label className={`label ${fixedCategoryId ? "sr-only" : ""}`} htmlFor="server_id">Servidor</label>
          <select id="server_id" name="server_id" defaultValue={initial?.server_id ?? servers[0]?.id ?? ""} className="input" required={slug === "adena"}>
            {slug !== "adena" && <option value="">Todos / no aplica</option>}
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {slug === "adena" && <p className="hint">La adena es por servidor: elegí dónde la entregás.</p>}
        </div>
      </section>

      {slug === "cuentas" && (
        <section className="card animate-fade-up grid gap-4 sm:grid-cols-3">
          <h2 className="h2 sm:col-span-3">Personaje</h2>
          <div>
            <label className="label" htmlFor="char_race">Raza</label>
            <select id="char_race" name="char_race" defaultValue={initial?.char_race ?? ""} className="input">
              <option value="">—</option>
              {RACES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="char_class">Clase</label>
            <input id="char_class" name="char_class" list="lu4-classes" defaultValue={initial?.char_class ?? ""} maxLength={40} className="input" placeholder="Ej: Archmage" />
            <datalist id="lu4-classes">{CLASSES.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="char_level">Nivel</label>
            <input id="char_level" name="char_level" type="number" min={1} max={99} defaultValue={initial?.char_level ?? ""} className="input" />
          </div>
        </section>
      )}

      <section className="card space-y-4">
        <h2 className="h2">Publicación</h2>
        <div>
          <label className="label" htmlFor="title">Título</label>
          <input id="title" name="title" defaultValue={initial?.title} required minLength={5} maxLength={120} className="input" placeholder={ph.title} />
        </div>
        <div>
          <label className="label" htmlFor="description">Descripción</label>
          <textarea id="description" name="description" defaultValue={initial?.description} required minLength={10} maxLength={5000} rows={5} className="input" placeholder={ph.description} />
        </div>
        <div>
          <label className="label" htmlFor="conditions">Condiciones</label>
          <textarea id="conditions" name="conditions" defaultValue={initial?.conditions} maxLength={3000} rows={3} className="input" placeholder="Ej: la entrega se coordina por el chat; no hago devoluciones una vez hecho el trade." />
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="h2">Precio y disponibilidad</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="price">Precio por {unit} (ARS)</label>
            <input id="price" name="price" value={price} onChange={(e) => setPrice(e.target.value)} required inputMode="decimal" placeholder={slug === "adena" ? "Ej: 45,00" : "Ej: 15.000"} className="input" />
            {slug === "adena" && <p className="hint">1 kk = 1.000.000 de adena.</p>}
          </div>
          <div>
            <label className="label" htmlFor="stock">Disponible ({plural})</label>
            <input id="stock" name="stock" type="number" min={0} max={10000000} defaultValue={initial?.stock ?? (slug === "adena" ? 1000 : 1)} required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="min_quantity">Compra mínima</label>
            <input id="min_quantity" name="min_quantity" type="number" min={1} max={1000000} defaultValue={initial?.min_quantity ?? 1} required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="delivery_time_hours">Entrega estimada (h)</label>
            <input id="delivery_time_hours" name="delivery_time_hours" type="number" min={1} max={720} defaultValue={initial?.delivery_time_hours ?? (slug === "adena" ? 1 : 24)} required className="input" />
          </div>
        </div>
        {quote && (
          <div className="animate-fade-up rounded-xl border border-gold/25 bg-gold/5 p-4 text-sm">
            <p>Por cada {unit} vendido a <strong className="text-gold-2">{formatARS(quote.priceCents)}</strong>:</p>
            <p className="mt-1 text-muted">
              Comisión Argenpay ({fees.commissionBps / 100}%): −{formatARS(quote.commissionCents)}
              {fees.processorFeePolicy === "vendedor_absorbe" && ` · Cargo del procesador: −${formatARS(quote.processorFeeCents)}`}
            </p>
            <p className="mt-1 font-display text-lg font-bold text-gold-2">Recibís {formatARS(quote.sellerNetCents)} por {unit}</p>
            <p className="hint">Estimación. El importe definitivo se calcula y fija en el servidor al crear cada orden.</p>
          </div>
        )}
      </section>

      <SubmitButton className="btn-primary shine px-8 py-3 text-base" pendingText="Guardando…">
        {initial ? "Guardar cambios" : `Publicar ${slug === "adena" ? "adena" : slug === "cuentas" ? "cuenta" : slug === "items" ? "ítem" : "servicio"}`}
      </SubmitButton>
    </form>
  );
}
