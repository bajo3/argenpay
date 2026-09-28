/**
 * Compresión de imágenes en el navegador antes de subirlas a Storage: redimensiona al lado máximo
 * indicado y baja la calidad hasta entrar en el límite. Así cualquier foto del celular (aunque pese
 * 10 MB) entra sin que la persona tenga que achicarla a mano.
 */
export interface CompressOptions {
  /** Lado más largo en píxeles. */
  maxSide: number;
  /** Tamaño máximo del resultado en bytes. */
  maxBytes: number;
  /** Dejar los GIF livianos sin tocar (conserva la animación). Por defecto sí. */
  keepGif?: boolean;
}

export class ImageError extends Error {}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Algunos navegadores no aceptan opciones o el formato; probamos con <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new ImageError("No pudimos leer esa imagen. Probá con una foto PNG, JPG o WEBP.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Devuelve un archivo listo para subir. Los GIF chicos se dejan tal cual (para no perder la animación);
 * todo lo demás se re-codifica en WEBP (o JPEG si el navegador no soporta WEBP).
 */
export async function compressImage(file: File, { maxSide, maxBytes, keepGif = true }: CompressOptions): Promise<File> {
  if (!file.type.startsWith("image/") && !/\.(heic|heif|png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
    throw new ImageError("El archivo no es una imagen.");
  }
  if (keepGif && file.type === "image/gif" && file.size <= maxBytes) return file;

  const source = await decode(file);
  const w = "naturalWidth" in source ? source.naturalWidth : source.width;
  const h = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!w || !h) throw new ImageError("No pudimos leer esa imagen.");

  // Ya es liviana y del tamaño correcto: no la tocamos.
  if (file.size <= maxBytes && Math.max(w, h) <= maxSide && ["image/webp", "image/jpeg", "image/png"].includes(file.type)) {
    if ("close" in source) source.close();
    return file;
  }

  let scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("Tu navegador no permite procesar imágenes.");

  const probe = await toBlob(Object.assign(document.createElement("canvas"), { width: 1, height: 1 }), "image/webp", 0.8);
  const type = probe?.type === "image/webp" ? "image/webp" : "image/jpeg";

  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    if (type === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.76, 0.64]) {
      const blob = await toBlob(canvas, type, quality);
      if (blob && blob.size <= maxBytes) {
        if ("close" in source) source.close();
        const name = file.name.replace(/\.[^.]+$/, "") + (type === "image/webp" ? ".webp" : ".jpg");
        return new File([blob], name, { type, lastModified: Date.now() });
      }
    }
    scale *= 0.75;
  }
  if ("close" in source) source.close();
  throw new ImageError("La imagen es demasiado grande incluso comprimida.");
}
