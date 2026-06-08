'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  onLoginConfirm: () => void;
  currentPrompt?: string;
  onCopyPrompt: () => void;
};

export default function GeminiLivePanel({ onLoginConfirm, currentPrompt, onCopyPrompt }: Props) {
  const popupRef = useRef<Window | null>(null);
  const [iframeBlocked, setIframeBlocked] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setIframeBlocked(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const openPopup = () => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }
    popupRef.current = window.open(
      'https://gemini.google.com/app',
      'mangatoanime-gemini',
      'width=960,height=720,menubar=no,toolbar=no,location=yes,status=no'
    );
  };

  return (
    <div className="gemini-live-box">
      <div className="gemini-live-header">
        <span>Gemini Live Interface</span>
        <span className="live-dot" />
      </div>
      <div className="gemini-live-body">
        {!iframeBlocked ? (
          <iframe
            title="Gemini"
            src="https://gemini.google.com/app"
            className="gemini-iframe"
            onError={() => setIframeBlocked(true)}
          />
        ) : (
          <div className="gemini-fallback">
            <p className="gemini-fallback-title">🌐 Gemini runs in a popup on web</p>
            <p className="gemini-fallback-sub">
              Browsers block embedding gemini.google.com on Vercel. Click below to open Gemini
              in a side popup — keep it open while you work.
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={openPopup}>
              Open Gemini Popup
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={onLoginConfirm}>
              ✓ I&apos;m signed in to Gemini
            </button>
            {currentPrompt && (
              <button type="button" className="btn btn-ghost btn-block" onClick={onCopyPrompt}>
                📋 Copy current panel prompt
              </button>
            )}
            <ol className="gemini-steps">
              <li>Sign in to Google in the popup</li>
              <li>Click <strong>+</strong> → <strong>Create image</strong></li>
              <li>Upload the manga panel shown in this app</li>
              <li>Paste the copied prompt → Send</li>
              <li>Download the output image → Upload Result here</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
