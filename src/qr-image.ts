// Reads a cylinder QR (or barcode) from a photo or screenshot, like "scan from gallery" in
// payment apps. The phone's built-in barcode reader is used when it exists (fast and good with
// blurry photos); otherwise the bundled ZXing reader tries the picture at a few sizes.

type Detector = { detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]> };
type DetectorClass = {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

async function loadPicture(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Honour the photo's rotation so sideways phone photos still read.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* Fall back to an <img> element below. */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // The decoded pixels stay available after the URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function nativeRead(picture: ImageBitmap | HTMLImageElement): Promise<string | null> {
  const Native = (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!Native) return null;
  try {
    const supported = (await Native.getSupportedFormats?.()) ?? ['qr_code'];
    const detector = new Native({
      formats: supported.filter((f) =>
        ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'].includes(f),
      ),
    });
    const found = await detector.detect(picture);
    return found.find((code) => code.rawValue.trim())?.rawValue.trim() ?? null;
  } catch {
    return null;
  }
}

async function zxingRead(picture: ImageBitmap | HTMLImageElement): Promise<string | null> {
  const [{ BrowserMultiFormatReader }, { DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]]));
  const width = 'naturalWidth' in picture ? picture.naturalWidth : picture.width;
  const height = 'naturalHeight' in picture ? picture.naturalHeight : picture.height;
  // Big camera photos read better smaller; tiny screenshots read better larger.
  for (const longest of [1200, 1800, 800, 2600]) {
    const scale = longest / Math.max(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    try {
      const text = reader.decodeFromCanvas(canvas).getText().trim();
      if (text) return text;
    } catch {
      /* No code at this size; try the next one. */
    }
  }
  return null;
}

/** The text inside the first QR or barcode found in the picture, or null if none was found. */
export async function readCodeFromImage(file: Blob): Promise<string | null> {
  if (!file.type.startsWith('image/') && file.type !== '') return null;
  const picture = await loadPicture(file);
  try {
    return (await nativeRead(picture)) ?? (await zxingRead(picture));
  } finally {
    if ('close' in picture) picture.close();
  }
}
