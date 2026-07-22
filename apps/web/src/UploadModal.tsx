import { useEffect, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Check, X } from 'lucide-react';
import type { ReferenceRole } from '@img3d/shared';

type UploadModalProps = {
  file: File;
  initialRole: ReferenceRole;
  onClose: () => void;
  onSubmit: (role: ReferenceRole, crop?: Area) => Promise<void>;
};

const roles: Array<{ value: ReferenceRole; label: string }> = [
  { value: 'hero', label: 'Hero / three-quarter' },
  { value: 'front', label: 'Front' },
  { value: 'left', label: 'Side / left' },
  { value: 'back', label: 'Back' },
  { value: 'right', label: 'Right' },
  { value: 'top', label: 'Top' },
  { value: 'detail', label: 'Material detail' },
];

export function UploadModal({ file, initialRole, onClose, onSubmit }: UploadModalProps) {
  const [url, setUrl] = useState('');
  const [role, setRole] = useState<ReferenceRole>(initialRole);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(role, pixels);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <div className="crop-modal">
        <header className="modal-header">
          <div>
            <span className="eyebrow"><span className="eyebrow-index">01</span> Mark the evidence</span>
            <h2 id="crop-title">Isolate the object</h2>
            <p>{file.name}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close upload"><X size={18} /></button>
        </header>
        <div className="crop-stage">
          {url && (
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              aspect={4 / 3}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, croppedAreaPixels) => setPixels(croppedAreaPixels)}
              showGrid
            />
          )}
          <div className="crop-reticle" aria-hidden="true" />
        </div>
        <div className="crop-controls">
          <label>
            <span>View role</span>
            <select value={role} onChange={(event) => setRole(event.target.value as ReferenceRole)}>
              {roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>Crop zoom</span>
            <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
        </div>
        {error && <p className="inline-error">{error}</p>}
        <footer className="modal-actions">
          <p>The original stays local. The marked crop becomes the primary evidence.</p>
          <button className="primary-button" onClick={submit} disabled={submitting}>
            {submitting ? <span className="spinner" /> : <Check size={17} />}
            {submitting ? 'Adding view…' : 'Add to capture pack'}
          </button>
        </footer>
      </div>
    </div>
  );
}
