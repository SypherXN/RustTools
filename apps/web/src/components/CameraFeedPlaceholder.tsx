type CameraFeedPlaceholderMode = "idle" | "connecting";

interface CameraFeedPlaceholderProps {
  mode: CameraFeedPlaceholderMode;
  cameraId?: string | null;
}

export function CameraFeedPlaceholder({ mode, cameraId }: CameraFeedPlaceholderProps) {
  const isConnecting = mode === "connecting";

  return (
    <div className="camera-feed-placeholder">
      <div className="camera-feed-placeholder__vignette" />
      <div className="camera-feed-placeholder__scanlines" />
      <div className="camera-feed-placeholder__grid" />

      <div className="camera-feed-placeholder__content">
        <div className={`camera-feed-placeholder__icon${isConnecting ? " camera-feed-placeholder__icon--pulse" : ""}`}>
          <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="60" cy="60" r="54" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
            <circle cx="60" cy="60" r="38" stroke="currentColor" strokeWidth="1" opacity="0.15" strokeDasharray="4 6" />
            <path
              d="M38 44h28l6-8h14a4 4 0 014 4v36a4 4 0 01-4 4H38a4 4 0 01-4-4V48a4 4 0 014-4z"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <circle cx="60" cy="62" r="14" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="60" cy="62" r="6" fill="currentColor" opacity="0.35" />
            <path d="M88 52l12-6v28l-12-6" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </div>

        <p className="camera-feed-placeholder__title">
          {isConnecting ? "Establishing feed…" : "No camera feed"}
        </p>
        <p className="camera-feed-placeholder__subtitle">
          {isConnecting && cameraId ? (
            <>
              Connecting to <code>{cameraId}</code>
            </>
          ) : (
            <>Select a saved camera or enter a CCTV ID above to connect</>
          )}
        </p>

        {isConnecting && <div className="camera-feed-placeholder__loader" aria-label="Connecting" />}
      </div>

      <div className="camera-feed-placeholder__hud">
        <span className="camera-feed-placeholder__rec">
          <span className="camera-feed-placeholder__rec-dot" />
          {isConnecting ? "LINK" : "STBY"}
        </span>
        <span className="camera-feed-placeholder__timestamp">NO SIGNAL</span>
      </div>
    </div>
  );
}
