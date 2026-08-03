"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  value?: string;
  onChange: (dataUrl: string) => void;
};

function isSignatureImage(value?: string) {
  return Boolean(value?.startsWith("data:image/"));
}

export function SignaturePad({ label, value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(isSignatureImage(value));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = canvas.clientWidth || 320;
    const height = 140;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#122033";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    if (isSignatureImage(value)) {
      const image = new Image();
      image.onload = () => {
        ctx.drawImage(image, 0, 0, width, height);
        setHasInk(true);
      };
      image.src = value!;
    } else {
      setHasInk(false);
    }
  }, [value]);

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function startDraw(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const point = pointFromEvent(event);
    if (!canvas || !ctx || !point) return;
    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function moveDraw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const point = pointFromEvent(event);
    if (!ctx || !point) return;
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    setHasInk(true);
  }

  function endDraw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    onChange(canvas.toDataURL("image/png"));
  }

  function clearPad() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.clientWidth || 320, 140);
    setHasInk(false);
    onChange("");
  }

  return (
    <div className="signature-pad">
      <div className="signature-pad-head">
        <span>{label}</span>
        <button type="button" className="daywork-remove" onClick={clearPad}>
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="signature-pad-canvas"
        aria-label={label}
        onPointerDown={startDraw}
        onPointerMove={moveDraw}
        onPointerUp={endDraw}
        onPointerCancel={endDraw}
      />
      <small>{hasInk ? "Signature captured" : "Sign with finger or stylus"}</small>
    </div>
  );
}

export function SignatureImage({ value, alt }: { value?: string; alt: string }) {
  if (!value?.trim()) return <span>—</span>;
  if (isSignatureImage(value)) {
    return <img className="signature-image" src={value} alt={alt} />;
  }
  return <span>{value}</span>;
}
