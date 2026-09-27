import type { Metadata } from "next";
import { InboxList } from "@/components/inbox-list";
import { Flash } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";

export const metadata: Metadata = { title: "Mensajes" };

export default async function InboxPage(props: PageProps<"/mensajes">) {
  const sp = await props.searchParams;
  const s = await requireUser("/mensajes");
  const conversations = await listConversations(s.userId);
  return (
    <div className="space-y-4">
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid overflow-hidden rounded-2xl border border-line bg-surface/80 md:grid-cols-[320px_1fr]">
        <div className="max-h-[78vh] overflow-y-auto md:border-r md:border-line">
          <p className="border-b border-line px-4 py-4 font-display text-xl font-bold">Mensajes</p>
          <InboxList conversations={conversations} />
        </div>
        <div className="hidden min-h-[60vh] place-items-center p-10 text-center text-sm text-muted md:grid">
          <div>
            <span className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full border border-gold/30 bg-gold/10 text-2xl text-gold-2 animate-glow">💬</span>
            <p className="font-display text-lg text-ink">Elegí una conversación</p>
            <p className="mt-1">Los avisos de tus compras y ventas también aparecen acá.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
