import { useMemo, useState } from 'react';
import { Check, Plus, ScanText, Trash2, X } from 'lucide-react';
import type { VideoCapture } from '@img3d/shared';
import { captureFrameUrl } from './api';

type ReviewText = {
  id?: string;
  value: string;
  frameId: string;
  bounds?: { x: number; y: number; width: number; height: number };
  exportAllowed: boolean;
};

type Props = {
  projectId: string;
  capture: VideoCapture;
  onClose: () => void;
  onAccept: (input: { frameIds: string[]; texts: ReviewText[] }) => Promise<void>;
};

export function VideoCaptureReview({ projectId, capture, onClose, onAccept }: Props) {
  const initialFrames = useMemo(() => capture.frames.filter((frame) => frame.selected).map((frame) => frame.id), [capture]);
  const [frameIds, setFrameIds] = useState(initialFrames);
  const [texts, setTexts] = useState<ReviewText[]>(() => capture.analysis?.detectedTexts.map((text) => ({
    id: text.id,
    value: text.value,
    frameId: text.frameId,
    bounds: text.bounds,
    exportAllowed: true,
  })) ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const defaultFrameId = capture.frames.find((frame) => frame.assignedRole === 'hero')?.id ?? capture.frames[0]?.id ?? '';

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await onAccept({ frameIds, texts: texts.filter((text) => text.value.trim()).map((text) => ({ ...text, value: text.value.trim() })) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="video-review-title">
      <div className="capture-review-modal">
        <header className="modal-header">
          <div>
            <span className="eyebrow"><span className="eyebrow-index">01</span> Automatic capture pack</span>
            <h2 id="video-review-title">These are the views we’ll use</h2>
            <p>You don’t need to name the angles. Remove only a frame that is clearly blurry or blocked.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close video review"><X size={18} /></button>
        </header>

        <section className="capture-frame-grid">
          {capture.frames.map((frame) => {
            const selected = frameIds.includes(frame.id);
            return (
              <button
                key={frame.id}
                className={`capture-frame ${selected ? 'selected' : ''}`}
                onClick={() => setFrameIds((current) => selected ? current.filter((id) => id !== frame.id) : current.length < 8 ? [...current, frame.id] : current)}
                aria-pressed={selected}
              >
                <img src={captureFrameUrl(projectId, capture.id, frame.id)} alt={`Video view at ${(frame.timestampMs / 1_000).toFixed(1)} seconds`} />
                <span>{selected ? <Check size={13} /> : null}{(frame.timestampMs / 1_000).toFixed(1)}s</span>
              </button>
            );
          })}
        </section>

        <section className="detected-text-section">
          <div className="capture-section-heading">
            <span><ScanText size={16} /> Text on the object</span>
            <button onClick={() => setTexts((current) => [...current, { value: '', frameId: defaultFrameId, exportAllowed: true }])}><Plus size={14} /> Add text</button>
          </div>
          <p>Confirm the exact spelling. We use this wording to draw a crisp local label instead of guessing from a reflection.</p>
          {texts.length === 0 ? (
            <button className="empty-text-button" onClick={() => setTexts([{ value: '', frameId: defaultFrameId, exportAllowed: true }])}>
              <Plus size={15} /> Add text if the object has a label, logo, or engraving
            </button>
          ) : (
            <div className="detected-text-list">
              {texts.map((text, index) => (
                <label key={text.id ?? index}>
                  <span>Confirmed phrase {index + 1}</span>
                  <div>
                    <input
                      value={text.value}
                      onChange={(event) => setTexts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                      placeholder="e.g. POCARI SWEAT"
                      maxLength={200}
                    />
                    <button onClick={() => setTexts((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove confirmed phrase ${index + 1}`}><Trash2 size={15} /></button>
                  </div>
                </label>
              ))}
            </div>
          )}
          <details className="capture-advanced">
            <summary>Advanced capture details</summary>
            <ul>
              {capture.frames.map((frame) => (
                <li key={frame.id}>{(frame.timestampMs / 1_000).toFixed(1)}s · {frame.assignedRole ?? 'detail'} · {Math.round((frame.confidence ?? 0) * 100)}% view confidence</li>
              ))}
            </ul>
          </details>
        </section>

        {capture.analysis?.warnings.map((warning) => <p className="capture-warning" key={warning}>{warning}</p>)}
        {error && <p className="inline-error capture-review-error">{error}</p>}
        <footer className="modal-actions">
          <p>Only confirmed label crops can be included in the exported model. The source video never leaves this machine or enters the ZIP.</p>
          <button className="primary-button" disabled={submitting || frameIds.length === 0} onClick={() => void submit()}>
            {submitting ? <span className="spinner" /> : <Check size={17} />}
            {submitting ? 'Preparing capture pack…' : `Use ${frameIds.length} selected views`}
          </button>
        </footer>
      </div>
    </div>
  );
}
