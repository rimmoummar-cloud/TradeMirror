import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  FolderOpen, FileText, Download, Eye, Upload, Trash2, Truck, FilePlus2, Loader2, GitCompare,
} from 'lucide-react';
import {
  documentsApi, type TradeDocument, type TradeDocumentType, type TradeGeneration,
} from '../../lib/api';
import { showToast } from '../../lib/toast';
import { VersionCompareModal } from '../versions/VersionCompareModal';

interface TradeFolderProps {
  tradeId: string;
  originalPdfUrl: string | null;
  generations: TradeGeneration[];
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx';

function formatBytes(bytes: number | null): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileDate(iso: string): string {
  try {
    return format(new Date(iso), 'PPp');
  } catch {
    return iso;
  }
}

/** A small "View / Download" pair for any stored file URL. */
function FileActions({ url, fileName }: { url: string; fileName?: string }) {
  return (
    <div className="flex items-center gap-3">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
      >
        <Eye className="w-4 h-4" /> View
      </a>
      <a
        href={url}
        download={fileName}
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <Download className="w-4 h-4" /> Download
      </a>
    </div>
  );
}

/** Hidden-input upload button. For BOL it first asks for a BOL date inline. */
function UploadButton({
  label,
  icon,
  docType,
  tradeId,
  onUploaded,
  variant = 'secondary',
}: {
  label: string;
  icon: React.ReactNode;
  docType: TradeDocumentType;
  tradeId: string;
  onUploaded: () => void;
  variant?: 'primary' | 'secondary';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingBol, setPendingBol] = useState<File | null>(null);
  const [bolDate, setBolDate] = useState('');

  const mutation = useMutation({
    mutationFn: (vars: { file: File; date?: string }) =>
      documentsApi.upload(tradeId, vars.file, docType, vars.date),
    onSuccess: () => {
      showToast('Document uploaded.', 'success');
      setPendingBol(null);
      setBolDate('');
      onUploaded();
    },
    onError: () => showToast('Upload failed. Please try again.', 'error'),
  });

  const handleSelected = (file: File | undefined) => {
    if (!file) return;
    if (docType === 'bol') {
      setPendingBol(file); // ask for the BOL date before uploading
    } else {
      mutation.mutate({ file });
    }
  };

  const base =
    'inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
  const styles =
    variant === 'primary'
      ? 'bg-blue-600 text-white hover:bg-blue-700'
      : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50';

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={mutation.isPending}
        className={`${base} ${styles}`}
      >
        {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
        {mutation.isPending ? 'Uploading…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          handleSelected(e.target.files?.[0]);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />

      {/* BOL date prompt */}
      {pendingBol && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-sm text-amber-800">
            Selected <span className="font-medium">{pendingBol.name}</span>. Enter the BOL date:
          </p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={bolDate}
              onChange={(e) => setBolDate(e.target.value)}
              className="px-2 py-1.5 border border-slate-300 rounded-md text-sm"
            />
            <button
              type="button"
              disabled={!bolDate || mutation.isPending}
              onClick={() => mutation.mutate({ file: pendingBol, date: bolDate })}
              className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              Confirm upload
            </button>
            <button
              type="button"
              onClick={() => { setPendingBol(null); setBolDate(''); }}
              className="px-3 py-1.5 rounded-md text-sm text-slate-600 hover:text-slate-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionCard({
  title, icon, count, action, children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
        {icon}
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {count !== undefined && <span className="text-sm text-slate-500">· {count}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function DocRow({
  doc, onDelete, deleting,
}: {
  doc: TradeDocument;
  onDelete?: (id: string) => void;
  deleting?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-slate-100 text-slate-500 shrink-0">
          <FileText className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">{doc.file_name}</p>
          <p className="text-xs text-slate-500">
            {fileDate(doc.created_at)}
            {doc.size_bytes ? ` · ${formatBytes(doc.size_bytes)}` : ''}
            {doc.bol_date ? ` · BOL date ${doc.bol_date}` : ''}
            {doc.uploaded_by ? ` · by ${doc.uploaded_by.slice(0, 8)}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <FileActions url={doc.file_url} fileName={doc.file_name} />
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(doc.id)}
            disabled={deleting}
            className="text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </li>
  );
}

export function TradeFolder({ tradeId, originalPdfUrl, generations }: TradeFolderProps) {
  const queryClient = useQueryClient();

  // Version comparison: clicking "Compare" on version N diffs it against the
  // previous version's snapshot (or the Original state for version 1).
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const byVersion = new Map(generations.map((g) => [g.version, g]));
  const openCompare = compareVersion != null ? byVersion.get(compareVersion) ?? null : null;
  const prevGen = compareVersion != null ? byVersion.get(compareVersion - 1) ?? null : null;

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['trade-documents', tradeId],
    queryFn: () => documentsApi.list(tradeId),
    enabled: !!tradeId,
    staleTime: 0,
  });

  const refetch = () =>
    queryClient.invalidateQueries({ queryKey: ['trade-documents', tradeId] });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => documentsApi.remove(tradeId, docId),
    onSuccess: () => {
      showToast('Document deleted.', 'success');
      refetch();
    },
    onError: () => showToast('Failed to delete document.', 'error'),
  });

  const handleDelete = (docId: string) => {
    if (!window.confirm('Delete this document? This cannot be undone.')) return;
    deleteMutation.mutate(docId);
  };

  const signed = documents.filter((d) => d.doc_type === 'signed_contract');
  const bols = documents.filter((d) => d.doc_type === 'bol');
  const additional = documents.filter((d) => d.doc_type === 'additional');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <FolderOpen className="w-5 h-5 text-slate-400" />
        <h2 className="text-xl font-bold text-slate-900">Trade Folder</h2>
      </div>

      {/* Original Frigo Contract */}
      <SectionCard title="Original Frigo Contract" icon={<FileText className="w-5 h-5 text-slate-400" />}>
        {originalPdfUrl ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-700">The source contract uploaded for this trade.</p>
            <FileActions url={originalPdfUrl} fileName="original-frigo-contract.pdf" />
          </div>
        ) : (
          <p className="text-sm text-slate-500">No original contract on file.</p>
        )}
      </SectionCard>

      {/* Generated Sales Contract versions */}
      <SectionCard
        title="Generated Sales Contract"
        icon={<FileText className="w-5 h-5 text-slate-400" />}
        count={generations.length}
      >
        {generations.length === 0 ? (
          <p className="text-sm text-slate-500">No versions generated yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {generations.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-blue-100 text-blue-700 text-sm font-semibold">
                    v{g.version}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      Version {g.version}{g.version === 1 ? ' (Original)' : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {fileDate(g.created_at)}
                      {g.created_by ? ` · by ${g.created_by.slice(0, 8)}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setCompareVersion(g.version)}
                    className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-blue-700 transition-colors"
                    title={g.version === 1 ? 'Compare with Original state' : `Compare with Version ${g.version - 1}`}
                  >
                    <GitCompare className="w-4 h-4" /> Compare
                  </button>
                  <FileActions url={g.generated_pdf_url} fileName={`sales-contract-v${g.version}.pdf`} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Version comparison modal. Version 1 has no same-shaped predecessor, so
          it opens as the baseline rather than a noisy diff against raw parse. */}
      <VersionCompareModal
        open={openCompare != null}
        onClose={() => setCompareVersion(null)}
        isBaseline={openCompare != null && !prevGen}
        oldLabel={prevGen ? `Version ${prevGen.version}` : 'Original'}
        newLabel={openCompare ? `Version ${openCompare.version}` : ''}
        oldSnapshot={prevGen?.snapshot ?? {}}
        newSnapshot={openCompare?.snapshot ?? {}}
      />

      {/* Signed Sales Contract (singleton: upload replaces) */}
      <SectionCard
        title="Signed Sales Contract"
        icon={<FileText className="w-5 h-5 text-slate-400" />}
        action={
          <UploadButton
            label={signed.length ? 'Replace' : 'Upload'}
            icon={<Upload className="w-4 h-4" />}
            docType="signed_contract"
            tradeId={tradeId}
            onUploaded={refetch}
          />
        }
      >
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : signed.length === 0 ? (
          <p className="text-sm text-slate-500">No signed contract uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {signed.map((d) => (
              <DocRow key={d.id} doc={d} onDelete={handleDelete} deleting={deleteMutation.isPending} />
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Bill of Lading */}
      <SectionCard
        title="Bill of Lading (BOL)"
        icon={<Truck className="w-5 h-5 text-slate-400" />}
        count={bols.length}
        action={
          <UploadButton
            label="Upload BOL"
            icon={<Upload className="w-4 h-4" />}
            docType="bol"
            tradeId={tradeId}
            onUploaded={refetch}
          />
        }
      >
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : bols.length === 0 ? (
          <p className="text-sm text-slate-500">No Bill of Lading uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {bols.map((d) => (
              <DocRow key={d.id} doc={d} onDelete={handleDelete} deleting={deleteMutation.isPending} />
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Additional Documents */}
      <SectionCard
        title="Additional Documents"
        icon={<FilePlus2 className="w-5 h-5 text-slate-400" />}
        count={additional.length}
        action={
          <UploadButton
            label="Add Document"
            icon={<Upload className="w-4 h-4" />}
            docType="additional"
            tradeId={tradeId}
            onUploaded={refetch}
            variant="primary"
          />
        }
      >
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : additional.length === 0 ? (
          <p className="text-sm text-slate-500">No additional documents.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {additional.map((d) => (
              <DocRow key={d.id} doc={d} onDelete={handleDelete} deleting={deleteMutation.isPending} />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
