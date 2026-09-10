export type RecordCanvasOptions = {
  durationMs: number;
  fps?: number;
};

const MIME_CANDIDATES: Array<{ mimeType: string; extension: string }> = [
  { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4" },
  { mimeType: "video/mp4", extension: "mp4" },
  { mimeType: "video/webm;codecs=vp9,opus", extension: "webm" },
  { mimeType: "video/webm;codecs=vp9", extension: "webm" },
  { mimeType: "video/webm;codecs=vp8", extension: "webm" },
  { mimeType: "video/webm", extension: "webm" }
];

export function pickRecorderFormat() {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
      return candidate;
    }
  }
  return { mimeType: "", extension: "webm" };
}

export function findCaptureCanvas(root: ParentNode | null): HTMLCanvasElement | null {
  if (!root) {
    return null;
  }
  const overlay = root.querySelector<HTMLCanvasElement>(".webcam-walkers-canvas");
  if (overlay) {
    return overlay;
  }
  return root.querySelector("canvas");
}

export async function recordCanvas(
  canvas: HTMLCanvasElement,
  { durationMs, fps = 30 }: RecordCanvasOptions
): Promise<{ blob: Blob; extension: string }> {
  const format = pickRecorderFormat();
  if (!format || typeof canvas.captureStream !== "function") {
    throw new Error("This browser cannot record canvas video.");
  }

  const stream = canvas.captureStream(fps);
  const chunks: BlobPart[] = [];
  const recorder = format.mimeType
    ? new MediaRecorder(stream, {
        mimeType: format.mimeType,
        videoBitsPerSecond: 8_000_000
      })
    : new MediaRecorder(stream, { videoBitsPerSecond: 8_000_000 });

  const recorded = new Promise<{ blob: Blob; extension: string }>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      reject(new Error("Video recording failed."));
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const type = recorder.mimeType || format.mimeType || "video/webm";
      resolve({
        blob: new Blob(chunks, { type }),
        extension: format.extension
      });
    };
  });

  recorder.start(250);
  await waitMs(Math.max(400, durationMs));
  if (recorder.state !== "inactive") {
    recorder.stop();
  }
  return recorded;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function waitMs(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
