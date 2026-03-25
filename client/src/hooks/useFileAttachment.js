import { useState, useRef, useCallback, useEffect } from 'react';
import api from '../utils/apiClient';

/**
 * Headless hook — file picker with client-side reading.
 *
 * Three-layer pattern: this is the logic layer.
 * Integration: ChatPage (or any tool with file input needs)
 *
 * Text files (.txt .md .csv .json .js .ts etc.) are read via FileReader and
 * stored as { id, name, content } — injected into the message as text context.
 *
 * Images are resized and stored as { id, name, mimeType, data, preview } via
 * the same canvas pipeline as useClipboardMedia — sent as inline image blocks.
 *
 * Allowed file types are fetched from the admin app-settings on mount so the
 * file picker's `accept` attribute always reflects the org's configuration.
 */

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_SIDE    = 800;
const QUALITY     = 0.75;
const MAX_TEXT_BYTES = 500 * 1024; // 500 KB

const DEFAULT_TYPES = '.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,image/*';

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
        name:     file.name,
        mimeType: 'image/jpeg',
        data:     dataUrl.split(',')[1],
        preview:  dataUrl,
      });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function readTextFile(file) {
  return new Promise((resolve) => {
    if (file.size > MAX_TEXT_BYTES) {
      resolve({ id: Math.random().toString(36).slice(2), name: file.name, content: `[File too large to include — ${(file.size / 1024).toFixed(0)} KB]` });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => resolve({
      id:      Math.random().toString(36).slice(2),
      name:    file.name,
      content: e.target.result,
    });
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}

export function useFileAttachment() {
  const [files, setFiles]         = useState([]); // text attachments
  const [images, setImages]       = useState([]); // image attachments
  const [allowedTypes, setAllowed] = useState(DEFAULT_TYPES);
  const inputRef = useRef(null);

  // Load org-configured allowed types
  useEffect(() => {
    api.get('/api/admin/app-settings')
      .then(r => r.json())
      .then(data => { if (data.chat_allowed_file_types) setAllowed(data.chat_allowed_file_types); })
      .catch(() => {}); // silently fall back to default
  }, []);

  const processFile = useCallback(async (file) => {
    if (IMAGE_TYPES.includes(file.type) || file.type.startsWith('image/')) {
      const img = await resizeImage(file);
      if (img) setImages(prev => [...prev, img]);
    } else {
      const txt = await readTextFile(file);
      if (txt) setFiles(prev => [...prev, txt]);
    }
  }, []);

  const openPicker = useCallback(() => {
    if (!inputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = allowedTypes;
      input.onchange = (e) => {
        Array.from(e.target.files || []).forEach(processFile);
        input.value = '';
      };
      inputRef.current = input;
    } else {
      inputRef.current.accept = allowedTypes;
    }
    inputRef.current.click();
  }, [allowedTypes, processFile]);

  // Re-create input when allowedTypes changes
  useEffect(() => {
    inputRef.current = null;
  }, [allowedTypes]);

  const removeFile  = useCallback((id) => setFiles(prev => prev.filter(f => f.id !== id)), []);
  const removeImage = useCallback((id) => setImages(prev => prev.filter(i => i.id !== id)), []);
  const clear       = useCallback(() => { setFiles([]); setImages([]); }, []);

  return { files, images, openPicker, removeFile, removeImage, clear, allowedTypes };
}
