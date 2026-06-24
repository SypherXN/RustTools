import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MapCoordinateTransform } from "@rusttools/shared";
import { worldToMapPixel } from "@rusttools/shared";

export interface MapFocusTarget {
  worldX: number;
  worldY: number;
  /** Bump to re-focus the same coordinates. */
  nonce: number;
}

interface MapViewportProps {
  width: number;
  height: number;
  imageSrc?: string | null;
  demo?: boolean;
  transform: MapCoordinateTransform;
  focusTarget?: MapFocusTarget | null;
  children: ReactNode;
}

interface Pan {
  x: number;
  y: number;
}

interface ViewState {
  fitScale: number;
  userScale: number;
  pan: Pan;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const MIN_USER_SCALE = 0.35;
const MAX_USER_SCALE = 12;
const MIN_TOTAL_SCALE = 0.05;
const FOCUS_USER_SCALE = 3;

function computeFitScale(viewportWidth: number, mapWidth: number): number | null {
  if (viewportWidth < 1 || mapWidth < 1) return null;
  const scale = viewportWidth / mapWidth;
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

function totalScale(view: ViewState): number {
  return Math.max(MIN_TOTAL_SCALE, view.fitScale * view.userScale);
}

function constrainPan(pan: Pan, scale: number, width: number, height: number, vw: number, vh: number): Pan {
  if (vw < 1 || vh < 1) return pan;

  const mapW = width * scale;
  const mapH = height * scale;

  const x = mapW <= vw ? (vw - mapW) / 2 : clamp(pan.x, vw - mapW, 0);
  const y = mapH <= vh ? (vh - mapH) / 2 : clamp(pan.y, vh - mapH, 0);

  return { x, y };
}

function centerPan(fitScale: number, userScale: number, height: number, vh: number): Pan {
  const scaledH = height * fitScale * userScale;
  return { x: 0, y: (vh - scaledH) / 2 };
}

const DEFAULT_VIEW: ViewState = { fitScale: 1, userScale: 1, pan: { x: 0, y: 0 } };

export function MapViewport({
  width,
  height,
  imageSrc,
  demo,
  transform,
  focusTarget,
  children,
}: MapViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewState>(DEFAULT_VIEW);
  const viewportSizeRef = useRef({ w: 0, h: 0 });
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [dragging, setDragging] = useState(false);
  const [imageReady, setImageReady] = useState(demo);
  const loadedSrcRef = useRef<string | null>(demo ? "demo" : null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ x: number; y: number; pan: Pan } | null>(null);

  const markImageReady = useCallback(() => {
    if (demo) {
      loadedSrcRef.current = "demo";
      setImageReady(true);
      return;
    }
    if (!imageSrc) return;
    loadedSrcRef.current = imageSrc;
    setImageReady(true);
  }, [demo, imageSrc]);

  viewRef.current = view;

  const readViewport = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (vw < 1 || vh < 1) return null;
    return { vw, vh };
  }, []);

  const applyView = useCallback(
    (updater: (prev: ViewState) => ViewState) => {
      const dims = readViewport();
      setView((prev) => {
        const next = updater(prev);
        const scale = totalScale(next);
        const pan = dims
          ? constrainPan(next.pan, scale, width, height, dims.vw, dims.vh)
          : next.pan;
        const resolved = { ...next, pan };
        viewRef.current = resolved;
        return resolved;
      });
    },
    [readViewport, width, height],
  );

  const fitToView = useCallback(() => {
    const dims = readViewport();
    if (!dims) return;

    const nextFitScale = computeFitScale(dims.vw, width);
    if (nextFitScale == null) return;

    const pan = constrainPan(
      centerPan(nextFitScale, 1, height, dims.vh),
      nextFitScale,
      width,
      height,
      dims.vw,
      dims.vh,
    );

    const next: ViewState = { fitScale: nextFitScale, userScale: 1, pan };
    viewRef.current = next;
    setView(next);
  }, [readViewport, width, height]);

  const updateFitScaleForResize = useCallback(() => {
    const dims = readViewport();
    if (!dims) return;

    const { w: lastW, h: lastH } = viewportSizeRef.current;
    if (Math.abs(dims.vw - lastW) < 1 && Math.abs(dims.vh - lastH) < 1) return;
    viewportSizeRef.current = { w: dims.vw, h: dims.vh };

    const nextFitScale = computeFitScale(dims.vw, width);
    if (nextFitScale == null) return;

    applyView((prev) => ({ ...prev, fitScale: nextFitScale }));
  }, [applyView, readViewport, width]);

  const zoomAt = useCallback(
    (factor: number, anchorX: number, anchorY: number) => {
      applyView((prev) => {
        const nextUserScale = clamp(prev.userScale * factor, MIN_USER_SCALE, MAX_USER_SCALE);
        if (nextUserScale === prev.userScale) return prev;

        const ratio = nextUserScale / prev.userScale;
        return {
          ...prev,
          userScale: nextUserScale,
          pan: {
            x: anchorX - (anchorX - prev.pan.x) * ratio,
            y: anchorY - (anchorY - prev.pan.y) * ratio,
          },
        };
      });
    },
    [applyView],
  );

  // Initial fit when map dimensions are known — not when imageSrc changes.
  useLayoutEffect(() => {
    fitToView();
  }, [fitToView, width, height, demo]);

  useLayoutEffect(() => {
    if (demo) {
      setImageReady(true);
      loadedSrcRef.current = "demo";
      return;
    }
    if (!imageSrc) {
      setImageReady(false);
      loadedSrcRef.current = null;
      return;
    }
    if (loadedSrcRef.current === imageSrc) {
      setImageReady(true);
      return;
    }
    setImageReady(false);
    const img = imgRef.current;
    if (img?.complete) {
      markImageReady();
    }
  }, [demo, imageSrc, markImageReady]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => updateFitScaleForResize());
    });

    observer.observe(viewport);
    viewportSizeRef.current = {
      w: viewport.clientWidth,
      h: viewport.clientHeight,
    };

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [updateFitScaleForResize]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = viewport.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.002);
      zoomAt(factor, cursorX, cursorY);
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    if (!focusTarget) return;
    const dims = readViewport();
    if (!dims) return;

    const { x: px, y: py } = worldToMapPixel(focusTarget.worldX, focusTarget.worldY, transform);
    const fitScale = viewRef.current.fitScale;
    const userScale = clamp(FOCUS_USER_SCALE, MIN_USER_SCALE, MAX_USER_SCALE);
    const scale = Math.max(MIN_TOTAL_SCALE, fitScale * userScale);
    const pan = constrainPan(
      { x: dims.vw / 2 - px * scale, y: dims.vh / 2 - py * scale },
      scale,
      width,
      height,
      dims.vw,
      dims.vh,
    );
    const next: ViewState = { fitScale, userScale, pan };
    viewRef.current = next;
    setView(next);
  }, [focusTarget, readViewport, transform, width, height]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".map-marker-hit, .map-marker")) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, pan: { ...viewRef.current.pan } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    const dims = readViewport();
    const prev = viewRef.current;
    const scale = totalScale(prev);
    const pan = {
      x: dragStart.current.pan.x + (e.clientX - dragStart.current!.x),
      y: dragStart.current.pan.y + (e.clientY - dragStart.current!.y),
    };
    const nextPan = dims
      ? constrainPan(pan, scale, width, height, dims.vw, dims.vh)
      : pan;
    setView({ ...prev, pan: nextPan });
    viewRef.current = { ...prev, pan: nextPan };
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragStart.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    dragStart.current = null;
    applyView((prev) => prev);
  };

  const zoomBy = (factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    zoomAt(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
  };

  const scale = totalScale(view);
  const panX = Number.isFinite(view.pan.x) ? view.pan.x : 0;
  const panY = Number.isFinite(view.pan.y) ? view.pan.y : 0;
  const zoomPercent = Math.round(view.userScale * 100);
  const showImage = demo || Boolean(imageSrc);

  return (
    <div className="map-viewport-wrap">
      <div className="map-viewport-toolbar">
        <span className="muted map-viewport-hint">Scroll to zoom · Drag to pan · Click markers for details</span>
        <div className="map-viewport-controls">
          <button type="button" className="btn-secondary" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
            −
          </button>
          <span className="map-zoom-label">{zoomPercent}%</span>
          <button type="button" className="btn-secondary" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="btn-secondary" onClick={fitToView}>
            Fit
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`map-viewport${dragging ? " dragging" : ""}${imageReady || demo ? "" : " map-viewport-loading"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onDoubleClick={fitToView}
      >
        <div
          className="map-transform-layer"
          style={{
            width,
            height,
            transform: `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`,
          }}
        >
          {demo ? (
            <div className="map-demo-surface" style={{ width, height }} />
          ) : showImage && imageSrc ? (
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Rust server map"
              className={`map-image-native${imageReady ? " loaded" : ""}`}
              draggable={false}
              decoding="async"
              onLoad={markImageReady}
              onError={() => setImageReady(false)}
            />
          ) : null}
          <div className={`map-overlay-wrap${imageReady || demo ? " visible" : ""}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}
