'use client';

import React, { useState } from 'react';
import { SurveyProvider } from '@/context/SurveyContext';
import { LidarCapture } from './LidarCapture';
import { WorkTypeSelector } from './WorkTypeSelector';
import { QuoteDisplay } from './QuoteDisplay';
import type { SurveyStep } from '@/types/survey';

const STEPS: SurveyStep[] = [
  { id: 'lidar', label: 'Room Scan', order: 1 },
  { id: 'work-type', label: 'Work Type', order: 2 },
  { id: 'quote', label: 'Your Quote', order: 3 },
];

function SurveyFlowContent() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = STEPS[currentStepIndex];

  const handleNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
    }
  };

  const handleGoToStep = (stepIndex: number) => {
    setCurrentStepIndex(stepIndex);
  };

  const renderStep = () => {
    switch (currentStep.id) {
      case 'lidar':
        return <LidarCapture />;
      case 'work-type':
        return <WorkTypeSelector />;
      case 'quote':
        return <QuoteDisplay />;
      default:
        return null;
    }
  };

  return (
    <div className="survey-flow">
      {/* Progress Bar */}
      <div className="progress-container">
        <div className="progress-bar-wrapper">
          <div
            className="progress-bar"
            style={{
              width: `${((currentStepIndex + 1) / STEPS.length) * 100}%`,
            }}
          ></div>
        </div>
        <div className="progress-text">
          Step {currentStepIndex + 1} of {STEPS.length}
        </div>
      </div>

      {/* Step Indicators */}
      <div className="step-indicators">
        {STEPS.map((step, index) => (
          <button
            key={step.id}
            onClick={() => handleGoToStep(index)}
            className={`step-indicator ${
              index === currentStepIndex ? 'active' : ''
            } ${index < currentStepIndex ? 'completed' : ''}`}
            disabled={index > currentStepIndex}
          >
            <span className="indicator-number">
              {index < currentStepIndex ? '✓' : index + 1}
            </span>
            <span className="indicator-label">{step.label}</span>
          </button>
        ))}
      </div>

      {/* Current Step Content */}
      <div className="step-content">{renderStep()}</div>

      <style jsx>{`
        .survey-flow {
          min-height: 100vh;
          background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
          padding: 2rem 1rem;
        }

        .progress-container {
          max-width: 1000px;
          margin: 0 auto 3rem;
        }

        .progress-bar-wrapper {
          height: 4px;
          background: #e5e7eb;
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 0.75rem;
        }

        .progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #0066cc, #00a3ff);
          transition: width 0.3s ease;
        }

        .progress-text {
          text-align: right;
          font-size: 0.875rem;
          color: #6b7280;
          font-weight: 500;
        }

        .step-indicators {
          display: flex;
          justify-content: space-between;
          max-width: 1000px;
          margin: 0 auto 3rem;
          gap: 1rem;
        }

        .step-indicator {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem;
          background: white;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s ease;
          position: relative;
        }

        .step-indicator:hover:not(:disabled) {
          border-color: #0066cc;
          box-shadow: 0 4px 12px rgba(0, 102, 204, 0.15);
        }

        .step-indicator:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .step-indicator.active {
          border-color: #0066cc;
          background: #eff6ff;
        }

        .step-indicator.completed {
          border-color: #10b981;
          background: #f0fdf4;
        }

        .indicator-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          font-weight: 700;
          font-size: 1rem;
          background: #f3f4f6;
          color: #6b7280;
        }

        .step-indicator.active .indicator-number {
          background: #0066cc;
          color: white;
        }

        .step-indicator.completed .indicator-number {
          background: #10b981;
          color: white;
        }

        .indicator-label {
          font-size: 0.875rem;
          font-weight: 600;
          color: #374151;
          text-align: center;
        }

        .step-indicator.active .indicator-label {
          color: #0066cc;
        }

        .step-indicator.completed .indicator-label {
          color: #10b981;
        }

        .step-content {
          max-width: 1000px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
          animation: slideIn 0.3s ease;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 768px) {
          .survey-flow {
            padding: 1rem;
          }

          .step-indicators {
            gap: 0.5rem;
          }

          .step-indicator {
            padding: 0.75rem 0.5rem;
            flex-direction: column;
          }

          .indicator-label {
            font-size: 0.75rem;
          }

          .indicator-number {
            width: 28px;
            height: 28px;
            font-size: 0.875rem;
          }
        }
      `}</style>
    </div>
  );
}

export function SurveyFlow() {
  return (
    <SurveyProvider>
      <SurveyFlowContent />
    </SurveyProvider>
  );
}
