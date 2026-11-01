const MAX_PROFILE_IMAGE_BYTES = 8 * 1024 * 1024;
const PROFILE_IMAGE_SIZE = 384;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ACCEPTED_EXTENSION = /\.(jpe?g|png|webp|gif)$/i;

export async function prepareProfileImage(file: File): Promise<string> {
  const typeAccepted = file.type
    ? ACCEPTED_TYPES.has(file.type)
    : ACCEPTED_EXTENSION.test(file.name);
  if (!typeAccepted) {
    throw new Error('Choose a JPG, PNG, WebP or GIF image.');
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error('Choose an image smaller than 8 MB.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be read.');
  }

  try {
    const sourceSize = Math.min(bitmap.width, bitmap.height);
    if (!sourceSize) throw new Error('This image could not be read.');

    const sourceX = Math.round((bitmap.width - sourceSize) / 2);
    const sourceY = Math.round((bitmap.height - sourceSize) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = PROFILE_IMAGE_SIZE;
    canvas.height = PROFILE_IMAGE_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This image could not be prepared.');

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      PROFILE_IMAGE_SIZE,
      PROFILE_IMAGE_SIZE,
    );

    const dataUrl = canvas.toDataURL('image/webp', 0.88);
    if (!dataUrl.startsWith('data:image/')) {
      throw new Error('This image could not be prepared.');
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}

export async function prepareProfileBanner(file: File): Promise<string> {
  const typeAccepted = file.type
    ? ACCEPTED_TYPES.has(file.type)
    : ACCEPTED_EXTENSION.test(file.name);
  if (!typeAccepted) {
    throw new Error('Choose a JPG, PNG, WebP or GIF image.');
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error('Choose an image smaller than 8 MB.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be read.');
  }

  try {
    const targetWidth = 1280;
    const targetHeight = 400;
    const targetAspect = targetWidth / targetHeight;
    const sourceAspect = bitmap.width / bitmap.height;
    let sourceWidth = bitmap.width;
    let sourceHeight = bitmap.height;
    if (sourceAspect > targetAspect) sourceWidth = Math.round(bitmap.height * targetAspect);
    else sourceHeight = Math.round(bitmap.width / targetAspect);
    const sourceX = Math.round((bitmap.width - sourceWidth) / 2);
    const sourceY = Math.round((bitmap.height - sourceHeight) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This image could not be prepared.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    );
    const dataUrl = canvas.toDataURL('image/webp', 0.86);
    if (!dataUrl.startsWith('data:image/')) {
      throw new Error('This image could not be prepared.');
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
