/**
 * Headless hook — clipboard image paste with client-side resize.
 *
 * Three-layer pattern: this is the logic layer.
 * Integration: ChatPage (or any tool with a text input)
 *
 * Images are resized to MAX_SIDE px on the longest edge, encoded as JPEG at
 * QUALITY, and stored as { id, mimeType, data (base64), preview (data-URL) }.
 * No server round-trip required.
 */

import { useState, useCallback } from 'react';

const MAX_SIDE = 800;
const QUALITY  = 0.75;

function resizeImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
      resolve({
        id:       Math.random().toString(36).slice(2),
        mimeType: 'image/jpeg',
        data:     dataUrl.split(',')[1],
        preview:  dataUrl,
      });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

export function useClipboardMedia() {
  const [images, setImages] = useState([]);

  const addFromPaste = useCallback(async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (!imageItems.length) return false; // signal: no image, let default paste proceed

    e.preventDefault();
    const results = await Promise.all(
      imageItems.map(item => resizeImage(item.getAsFile()))
    );
    setImages(prev => [...prev, ...results.filter(Boolean)]);
    return true; // signal: image was handled
  }, []);

  const removeImage = useCallback((id) => {
    setImages(prev => prev.filter(img => img.id !== id));
  }, []);

  const clear = useCallback(() => setImages([]), []);

  return { images, addFromPaste, removeImage, clear };
}
