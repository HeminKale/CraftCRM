'use client';

import React, { forwardRef, useRef, useEffect, useState, useCallback, useImperativeHandle } from 'react';
import SignaturePadLib from 'signature_pad';

export interface SignaturePadHandle {
  getBlob: () => Promise<Blob | null>;
  clear: () => void;
  isEmpty: () => boolean;
}

interface Props {
  onSigned?: (blob: Blob) => void;
  onCancel?: () => void;
  onStrokeEnd?: (isEmpty: boolean) => void;
  disabled?: boolean;
  hideActions?: boolean;
}

const SignaturePad = forwardRef<SignaturePadHandle, Props>(
  ({ onSigned, onCancel, onStrokeEnd, disabled, hideActions }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const padRef = useRef<SignaturePadLib | null>(null);
    const [isEmpty, setIsEmpty] = useState(true);

    useImperativeHandle(ref, () => ({
      getBlob: () =>
        new Promise<Blob | null>(resolve => {
          if (!canvasRef.current || padRef.current?.isEmpty()) { resolve(null); return; }
          canvasRef.current.toBlob(blob => resolve(blob), 'image/png');
        }),
      clear: () => { padRef.current?.clear(); setIsEmpty(true); onStrokeEnd?.(true); },
      isEmpty: () => padRef.current?.isEmpty() ?? true,
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ratio = window.devicePixelRatio || 1;
      canvas.width  = canvas.offsetWidth  * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(ratio, ratio);

      padRef.current = new SignaturePadLib(canvas, {
        backgroundColor: 'rgb(255,255,255)',
        penColor: '#1e3a5f',
        minWidth: 1.5,
        maxWidth: 3,
      });

      padRef.current.addEventListener('endStroke', () => {
        const empty = padRef.current?.isEmpty() ?? true;
        setIsEmpty(empty);
        onStrokeEnd?.(empty);
      });

      return () => { padRef.current?.off(); };
    }, []);

    const handleClear = () => {
      padRef.current?.clear();
      setIsEmpty(true);
      onStrokeEnd?.(true);
    };

    const handleSign = useCallback(() => {
      if (!padRef.current || padRef.current.isEmpty()) return;
      canvasRef.current?.toBlob(blob => { if (blob) onSigned?.(blob); }, 'image/png');
    }, [onSigned]);

    return (
      <div className="space-y-2">
        <div
          className="relative border-2 border-gray-300 rounded-md bg-white overflow-hidden"
          style={{ height: hideActions ? 100 : 140 }}
        >
          <canvas
            ref={canvasRef}
            className="w-full h-full touch-none"
            style={{ cursor: disabled ? 'not-allowed' : 'crosshair' }}
          />
          {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-gray-300 text-sm select-none">Sign here</p>
            </div>
          )}
        </div>

        {!hideActions && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled || isEmpty}
              className="text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-40"
            >
              Clear
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={disabled}
                className="px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSign}
                disabled={disabled || isEmpty}
                className="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Sign & Accept
              </button>
            </div>
          </div>
        )}

        {hideActions && !isEmpty && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Clear
          </button>
        )}
      </div>
    );
  }
);

SignaturePad.displayName = 'SignaturePad';
export default SignaturePad;
