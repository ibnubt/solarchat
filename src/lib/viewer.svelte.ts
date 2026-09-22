/** Penampil gambar layar penuh yang dipakai bersama oleh lampiran, gambar Markdown, dan diagram. */
export const viewer = $state({ src: '', alt: '', filename: '' });

export function openImage(src: string, alt = '', filename = '') {
  viewer.src = src;
  viewer.alt = alt;
  viewer.filename = filename;
}

export function closeImage() {
  viewer.src = '';
}
