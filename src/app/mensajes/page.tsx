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
      <h1 className="h1 animate-fade-up">Mensajes</h1>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="grid overflow-hidden rounded-2xl border border-line bg-surface/80 md:grid-cols-[320px_1fr]">
        <div className="max-h-[70vh] overflow-y-auto md:border-r md:border-line">
          <InboxList conversations={conversations} />
        </div>
        <div className="hidden place-items-center p-10 text-center text-sm text-muted md:grid">
          <div>
            <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full border border-gold/30 bg-gold/10 text-2xl text-gold-2">💬</span>
            Elegí una conversación para ver los mensajes.
            <br />
            Los avisos de tus órdenes también aparecen acá.
          </div>
        </div>
      </div>
    </div>
  );
}
