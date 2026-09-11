import { useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { LogoSource } from "./types";
import {
  MAX_CLIP_HOLD,
  MAX_CLIP_MORPH,
  MAX_TIMELINE_CLIPS,
  MIN_CLIP_HOLD,
  MIN_CLIP_MORPH,
  buildTimelineSegments,
  clipLetter
} from "./logoMorph";

export type TimelineClip = {
  id: string;
  source: LogoSource;
  hold: number;
  morph: number;
};

type TimingPatch = Partial<Pick<TimelineClip, "hold" | "morph">>;

type MorphTimelineBarProps = {
  clips: TimelineClip[];
  selectedId: string;
  time: number;
  duration: number;
  playing: boolean;
  loop: boolean;
  previews: Record<string, string>;
  onSeek: (time: number) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onTimingChange: (id: string, patch: TimingPatch) => void;
};

type DragKind = "hold" | "morph" | "playhead";

type DragState = {
  kind: DragKind;
  clipId: string;
  startX: number;
  startValue: number;
  pxPerSec: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatSeconds(value: number) {
  return `${value.toFixed(1)}s`;
}

function tickStep(duration: number) {
  if (duration <= 4) {
    return 0.5;
  }
  if (duration <= 10) {
    return 1;
  }
  if (duration <= 24) {
    return 2;
  }
  return 4;
}

export function MorphTimelineBar({
  clips,
  selectedId,
  time,
  duration,
  playing,
  loop,
  previews,
  onSeek,
  onSelect,
  onAdd,
  onRemove,
  onTimingChange
}: MorphTimelineBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const total = Math.max(0.001, duration);
  const { segments } = useMemo(
    () => buildTimelineSegments(clips, loop),
    [clips, loop]
  );
  const ticks = useMemo(() => {
    const step = tickStep(total);
    const values: number[] = [];
    for (let value = 0; value <= total + 0.001; value += step) {
      values.push(Number(value.toFixed(2)));
    }
    if (values[values.length - 1] < total - step * 0.45) {
      values.push(Number(total.toFixed(2)));
    }
    return values;
  }, [total]);

  const timeFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track) {
      return 0;
    }
    const rect = track.getBoundingClientRect();
    const ratio = rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width;
    return clamp(ratio * total, 0, total);
  };

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    kind: DragKind,
    clipId: string,
    startValue: number
  ) => {
    const track = trackRef.current;
    if (!track) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    track.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind,
      clipId,
      startX: event.clientX,
      startValue,
      pxPerSec: track.getBoundingClientRect().width / total
    };
  };

  const rounded = (value: number) => Math.round(value * 10) / 10;

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    if (drag.kind === "playhead") {
      onSeek(timeFromClientX(event.clientX));
      return;
    }
    const pxPerSec = Math.max(8, drag.pxPerSec);
    const next = rounded(drag.startValue + (event.clientX - drag.startX) / pxPerSec);
    if (drag.kind === "hold") {
      onTimingChange(drag.clipId, {
        hold: clamp(next, MIN_CLIP_HOLD, MAX_CLIP_HOLD)
      });
      return;
    }
    onTimingChange(drag.clipId, {
      morph: clamp(next, MIN_CLIP_MORPH, MAX_CLIP_MORPH)
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const playheadLeft = `${(clamp(time, 0, total) / total) * 100}%`;

  return (
    <div className="timeline-editor" aria-label="Logo morph timeline">
      <div className="timeline-toolbar">
        <span className="timeline-time">
          {formatSeconds(time)} / {formatSeconds(duration)}
          {playing ? " · play" : ""}
        </span>
        <span className="timeline-legend">
          <span className="timeline-legend-hold">clip</span>
          <span className="timeline-legend-morph">transition</span>
        </span>
        <button
          className="timeline-add"
          type="button"
          onClick={onAdd}
          disabled={clips.length >= MAX_TIMELINE_CLIPS}
          aria-label="Add logo clip"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="timeline-ruler" aria-hidden="true">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="timeline-tick"
            style={{ left: `${(tick / total) * 100}%` }}
          >
            {tick % 1 === 0 ? `${tick.toFixed(0)}s` : formatSeconds(tick)}
          </span>
        ))}
      </div>

      <div
        className="timeline-track"
        ref={trackRef}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          onSeek(timeFromClientX(event.clientX));
          beginDrag(event, "playhead", "", timeFromClientX(event.clientX));
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {segments.map((segment, index) => {
          const clip = clips[segment.from];
          if (!clip) {
            return null;
          }
          const letter = clipLetter(segment.from);
          const nextLetter = clipLetter(segment.to);
          const left = `${(segment.start / total) * 100}%`;
          const width = `${(segment.duration / total) * 100}%`;
          if (segment.kind === "hold") {
            const preview = previews[clip.id];
            const selected = clip.id === selectedId;
            return (
              <div
                key={`${clip.id}-hold`}
                className={`timeline-block hold ${selected ? "active" : ""} ${segment.duration < 0.9 ? "compact" : ""}`}
                style={{ left, width }}
                role="button"
                tabIndex={0}
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest(".timeline-handle, .timeline-clip-remove")) {
                    return;
                  }
                  onSelect(clip.id);
                  const nextTime = timeFromClientX(event.clientX);
                  onSeek(nextTime);
                  beginDrag(event, "playhead", "", nextTime);
                }}
              >
                <span className="timeline-block-preview" aria-hidden="true">
                  {preview ? <span dangerouslySetInnerHTML={{ __html: preview }} /> : letter}
                </span>
                <span className="timeline-block-meta">
                  <strong>{letter}</strong>
                  <small>{formatSeconds(clip.hold)}</small>
                </span>
                {clips.length > 2 && (
                  <span
                    className="timeline-clip-remove"
                    role="button"
                    aria-label={`Remove logo ${letter}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(clip.id);
                    }}
                  >
                    <Trash2 size={11} />
                  </span>
                )}
                <span
                  className="timeline-handle"
                  aria-label={`Resize ${letter} hold`}
                  onPointerDown={(event) => beginDrag(event, "hold", clip.id, clip.hold)}
                />
              </div>
            );
          }

          return (
            <div
              key={`${clip.id}-morph-${index}`}
              className={`timeline-block morph ${clip.id === selectedId ? "active" : ""} ${segment.duration < 1.1 ? "compact" : ""}`}
              style={{ left, width }}
              role="button"
              tabIndex={0}
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest(".timeline-handle")) {
                  return;
                }
                onSelect(clip.id);
                const nextTime = timeFromClientX(event.clientX);
                onSeek(nextTime);
                beginDrag(event, "playhead", "", nextTime);
              }}
            >
              <span className="timeline-block-meta morph-meta">
                <strong>
                  {letter}→{nextLetter}
                </strong>
                <small>{formatSeconds(clip.morph)}</small>
              </span>
              <span
                className="timeline-handle"
                aria-label={`Resize ${letter} to ${nextLetter} transition`}
                onPointerDown={(event) => beginDrag(event, "morph", clip.id, clip.morph)}
              />
            </div>
          );
        })}

        <span
          className="timeline-playhead"
          style={{ left: playheadLeft }}
          onPointerDown={(event) => beginDrag(event, "playhead", "", time)}
        />
      </div>
    </div>
  );
}
