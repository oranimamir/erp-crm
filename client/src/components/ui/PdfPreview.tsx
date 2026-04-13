import { useEffect, useState } from 'react';

interface PdfPreviewProps {
  base64: string | null | undefined;
  className?: string;
  title?: string;
}

// Renders a base64 PDF via a Blob URL rather than a data: URI.
// Data URIs silently fail to render in <iframe> for multi-MB PDFs on some
// browsers (Chrome/Edge PDF viewer has a ~2MB data-URL ceiling in practice);
// blob URLs have no such limit.
export default function PdfPreview({ base64, className, title }: PdfPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!base64) { setUrl(null); return; }
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.warn('PdfPreview: failed to decode base64 PDF', err);
      setUrl(null);
    }
  }, [base64]);

  if (!url) return null;
  return <iframe src={url} className={className} title={title || 'PDF Preview'} />;
}
