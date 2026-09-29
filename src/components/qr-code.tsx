import QRCode from "qrcode";

/**
 * QR generado en el servidor (SVG) con el texto indicado. Sirve para dar el alias/CVU o una dirección cripto
 * escaneable. No es un QR de pago interoperable: al escanearlo se lee el texto (la app de la billetera lo
 * reconoce si es una dirección cripto; en pesos hay que copiar el alias o CVU).
 */
export async function QrCode({ text, size = 128, label }: { text: string; size?: number; label: string }) {
  const svg = await QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  return (
    <div
      role="img"
      aria-label={label}
      className="shrink-0 overflow-hidden rounded-lg border border-line bg-white [&>svg]:h-full [&>svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
