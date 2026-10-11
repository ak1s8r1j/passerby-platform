import { useEffect, useRef, useState } from "react";

/** How long the stand-in ad runs. A real provider decides its own length. */
export const DEMO_AD_SECONDS = 5;

interface Props {
  /** The ad played to the end. */
  onComplete(): void;
  /** The visitor closed it first. No reward. */
  onClose(): void;
  seconds?: number;
}

/**
 * The rewarded ad: a 16:9 picture the width of the box, a progress bar and a close button. This stand-in
 * plays a few seconds of "sponsored video"; a real ad provider would replace the picture and keep the rest
 * (progress, close, and calling onComplete only when the ad was watched to the end).
 */
export function RewardedAd({ onComplete, onClose, seconds = DEMO_AD_SECONDS }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const done = useRef(onComplete);
  useEffect(() => {
    done.current = onComplete;
  });

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      const secondsIn = (Date.now() - started) / 1000;
      if (secondsIn >= seconds) {
        clearInterval(timer);
        setElapsed(seconds);
        done.current();
      } else {
        setElapsed(secondsIn);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [seconds]);

  const percent = Math.min(100, Math.round((elapsed / seconds) * 100));
  const left = Math.max(0, Math.ceil(seconds - elapsed));
  return (
    <div className="rewarded" role="group" aria-label="Rewarded ad">
      <div className="rewarded-video">
        <span className="rewarded-tag">Ad</span>
        <button
          type="button"
          className="xbtn rewarded-close"
          aria-label="Close ad"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <p className="rewarded-title">Sponsored video</p>
        <p className="rewarded-left">{left}s</p>
      </div>
      <div
        className="rewarded-bar"
        role="progressbar"
        aria-label="Ad progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="hint">Watch to the end to unlock the filters. Closing early gives nothing.</p>
    </div>
  );
}
