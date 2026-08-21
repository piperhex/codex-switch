import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Spin } from "antd";
import { Camera } from "lucide-react";
import type { Translate } from "../../../i18n";
import { parseOtpAuthUri, type TotpDraft } from "../../../utils/totp";
import { decodeQrVideoFrame } from "../qr";
import "./index.less";

const CAMERA_SCAN_INTERVAL_MS = 120;
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1_280 },
    height: { ideal: 720 },
  },
};

interface TotpCameraScannerProps {
  open: boolean;
  onCancel: () => void;
  onImport: (draft: TotpDraft) => void;
  t: Translate;
}

function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function cameraErrorMessage(cause: unknown, t: Translate) {
  if (cause instanceof Error && cause.message === "camera-unavailable") {
    return t("totp.cameraUnavailable");
  }
  if (!(cause instanceof DOMException)) return t("totp.cameraFailed");
  if (cause.name === "NotAllowedError" || cause.name === "SecurityError") {
    return t("totp.cameraDenied");
  }
  if (cause.name === "NotFoundError" || cause.name === "OverconstrainedError") {
    return t("totp.cameraUnavailable");
  }
  if (cause.name === "NotReadableError" || cause.name === "AbortError") {
    return t("totp.cameraBusy");
  }
  return t("totp.cameraFailed");
}

export function TotpCameraScanner({ open, onCancel, onImport, t }: TotpCameraScannerProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const importRef = useRef(onImport);

  useEffect(() => {
    importRef.current = onImport;
  }, [onImport]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let stream: MediaStream | null = null;
    setReady(false);
    setError("");

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera-unavailable");
      stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (!active) return stopCamera(stream);
      const video = videoRef.current;
      if (!video) return stopCamera(stream);
      video.srcObject = stream;
      await video.play();
      if (active) setReady(true);
    }

    void startCamera().catch((cause) => {
      stopCamera(stream);
      if (active) setError(cameraErrorMessage(cause, t));
    });
    return () => {
      active = false;
      stopCamera(stream);
    };
  }, [open, t]);

  useEffect(() => {
    if (!open || !ready) return;
    let frameId = 0;
    let previousScan = 0;
    const scanFrame = (timestamp: number) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && timestamp - previousScan >= CAMERA_SCAN_INTERVAL_MS) {
        previousScan = timestamp;
        let value = "";
        try {
          value = decodeQrVideoFrame(video, canvas);
        } catch {
          setError(t("totp.cameraFailed"));
          return;
        }
        if (value) {
          try {
            importRef.current(parseOtpAuthUri(value));
            return;
          } catch {
            setError(t("totp.cameraInvalid"));
          }
        }
      }
      frameId = window.requestAnimationFrame(scanFrame);
    };
    frameId = window.requestAnimationFrame(scanFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [open, ready, t]);

  return <Modal className="totp-camera-modal" open={open} centered width={560}
    title={t("totp.cameraTitle")} onCancel={onCancel} destroyOnHidden
    footer={<Button onClick={onCancel}>{t("table.cancel")}</Button>}>
    <div className="totp-camera-view">
      <video ref={videoRef} muted playsInline aria-label={t("totp.cameraTitle")} />
      {!ready && !error && <div className="totp-camera-loading">
        <Spin />
        <span>{t("totp.cameraStarting")}</span>
      </div>}
      {ready && <div className="totp-camera-frame" aria-hidden="true" />}
      <canvas ref={canvasRef} hidden />
    </div>
    {error ? <Alert type="error" showIcon message={error} /> : <div className="totp-camera-hint">
      <Camera size={15} />
      <span>{t("totp.cameraHint")}</span>
    </div>}
  </Modal>;
}
