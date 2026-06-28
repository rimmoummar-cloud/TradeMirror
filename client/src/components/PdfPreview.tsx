interface PdfPreviewProps {
  url: string;
}

export function PdfPreview({ url }: PdfPreviewProps) {
  return <iframe className="pdf-frame" src={url} title="Generated PDF preview" />;
}
