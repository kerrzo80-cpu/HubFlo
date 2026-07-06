'use client';

import React, { useRef, useState } from 'react';
import { useSurvey } from '@/context/SurveyContext';

export function LidarCapture() {
  const { uploadLidarImage, lidarData, isLoading, error, nextStep } = useSurvey();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Upload and process
    try {
      await uploadLidarImage(file);
    } catch (err) {
      console.error('Failed to process LIDAR image:', err);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="survey-step lidar-capture">
      <div className="step-header">
        <h2>Room Scan</h2>
        <p>Capture or upload a LIDAR image of your bathroom</p>
      </div>

      <div className="lidar-content">
        {/* Preview */}
        {(previewUrl || lidarData?.imageUrl) && (
          <div className="lidar-preview">
            <img
              src={previewUrl || lidarData?.imageUrl}
              alt="LIDAR scan"
              className="preview-image"
            />
            <div className="preview-overlay">
              <span className="success-badge">✓ Image captured</span>
            </div>
          </div>
        )}

        {/* Upload area */}
        {!lidarData && (
          <div className="upload-area">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.ply,.obj,.las"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              disabled={isLoading}
            />

            <button
              onClick={handleUploadClick}
              disabled={isLoading}
              className="upload-button"
            >
              {isLoading ? (
                <>
                  <span className="spinner"></span>
                  Processing...
                </>
              ) : (
                <>
                  <span className="icon">📷</span>
                  Upload LIDAR Image
                </>
              )}
            </button>

            <p className="upload-hint">
              Supports: JPG, PNG, TIFF, PLY, OBJ, LAS formats
            </p>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="error-message">
            <span>⚠️</span>
            <p>{error}</p>
          </div>
        )}

        {/* Captured data display */}
        {lidarData && (
          <div className="lidar-info">
            <div className="info-section">
              <h3>Captured Dimensions</h3>
              <div className="dimensions-grid">
                <div className="dimension-item">
                  <span className="label">Length</span>
                  <span className="value">{lidarData.dimensions.length.toFixed(2)}m</span>
                </div>
                <div className="dimension-item">
                  <span className="label">Width</span>
                  <span className="value">{lidarData.dimensions.width.toFixed(2)}m</span>
                </div>
                <div className="dimension-item">
                  <span className="label">Height</span>
                  <span className="value">{lidarData.dimensions.height.toFixed(2)}m</span>
                </div>
                <div className="dimension-item">
                  <span className="label">Area</span>
                  <span className="value">{lidarData.dimensions.area.toFixed(2)}m²</span>
                </div>
              </div>
            </div>

            <div className="info-section">
              <p className="captured-at">
                Captured at {new Date(lidarData.capturedAt).toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="step-footer">
        {lidarData && (
          <button onClick={nextStep} className="button button-primary">
            Next: Review Dimensions
          </button>
        )}
      </div>

      <style jsx>{`
        .survey-step {
          padding: 2rem;
          max-width: 800px;
          margin: 0 auto;
        }

        .step-header {
          margin-bottom: 2rem;
        }

        .step-header h2 {
          font-size: 1.75rem;
          font-weight: 600;
          margin: 0 0 0.5rem 0;
          color: #1f2937;
        }

        .step-header p {
          font-size: 1rem;
          color: #6b7280;
          margin: 0;
        }

        .lidar-content {
          background: #f9fafb;
          border-radius: 12px;
          padding: 2rem;
          margin-bottom: 2rem;
        }

        .lidar-preview {
          position: relative;
          margin-bottom: 2rem;
          border-radius: 8px;
          overflow: hidden;
          background: #fff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .preview-image {
          width: 100%;
          height: auto;
          display: block;
          max-height: 400px;
          object-fit: cover;
        }

        .preview-overlay {
          position: absolute;
          top: 1rem;
          right: 1rem;
        }

        .success-badge {
          background: #10b981;
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .upload-area {
          text-align: center;
          padding: 2rem;
          border: 2px dashed #e5e7eb;
          border-radius: 8px;
          background: white;
        }

        .upload-button {
          background: #0066cc;
          color: white;
          border: none;
          padding: 1rem 2rem;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          transition: background 0.2s;
        }

        .upload-button:hover:not(:disabled) {
          background: #0052a3;
        }

        .upload-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .icon {
          font-size: 1.5rem;
        }

        .spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid #ffffff;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .upload-hint {
          margin-top: 1rem;
          font-size: 0.875rem;
          color: #9ca3af;
        }

        .error-message {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 1rem;
          background: #fee;
          border: 1px solid #fca5a5;
          border-radius: 6px;
          color: #dc2626;
          font-size: 0.875rem;
        }

        .error-message span {
          font-size: 1.25rem;
          flex-shrink: 0;
        }

        .lidar-info {
          margin-top: 2rem;
          padding-top: 2rem;
          border-top: 1px solid #e5e7eb;
        }

        .info-section {
          margin-bottom: 1.5rem;
        }

        .info-section h3 {
          margin: 0 0 1rem 0;
          font-size: 1rem;
          font-weight: 600;
          color: #1f2937;
        }

        .dimensions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 1rem;
        }

        .dimension-item {
          background: white;
          padding: 1rem;
          border-radius: 6px;
          border: 1px solid #e5e7eb;
          text-align: center;
        }

        .dimension-item .label {
          display: block;
          font-size: 0.75rem;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
          margin-bottom: 0.5rem;
        }

        .dimension-item .value {
          display: block;
          font-size: 1.5rem;
          font-weight: 700;
          color: #0066cc;
        }

        .captured-at {
          font-size: 0.875rem;
          color: #9ca3af;
          margin: 0;
        }

        .step-footer {
          display: flex;
          justify-content: flex-end;
          gap: 1rem;
        }

        .button {
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 6px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .button-primary {
          background: #0066cc;
          color: white;
        }

        .button-primary:hover {
          background: #0052a3;
        }
      `}</style>
    </div>
  );
}
