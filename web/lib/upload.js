'use client';
/**
 * Image upload for team photos and backgrounds.
 * Big photos are shrunk in the browser first (fast upload, small files):
 * team photos to 512px, backgrounds to 1920px, saved as WebP (keeps transparency).
 * GIFs are sent as-is so animations keep working.
 */
import { api } from './api';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة')); };
    img.src = url;
  });
}
const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('تعذر قراءة الملف')); r.readAsDataURL(blob);
});

export async function uploadImage(file, { max = 512 } = {}) {
  if (!file) throw new Error('لم يتم اختيار ملف');
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) throw new Error('استخدم صورة PNG أو JPG أو WebP أو GIF');
  let blob = file;
  if (!/gif/i.test(file.type)) {
    const img = await loadImage(file);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.88));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/png')); // older Safari
  }
  if (blob.size > 6 * 1024 * 1024) throw new Error('الصورة كبيرة جداً (الحد 6 ميغابايت)');
  const r = await api('/api/upload', { method: 'POST', body: { data: await toDataUrl(blob) } });
  return r.url;
}

/** Opens the file picker and resolves with the chosen File (or null). */
export function pickFile(accept = 'image/png,image/jpeg,image/webp,image/gif') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}
