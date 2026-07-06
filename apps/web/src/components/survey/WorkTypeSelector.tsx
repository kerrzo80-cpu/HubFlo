'use client';

import React from 'react';
import { useSurvey } from '@/context/SurveyContext';
import type { WorkType } from '@/types/survey';

const WORK_TYPES: Array<{
  id: WorkType;
  title: string;
  description: string;
  icon: string;
  details: string[];
}> = [
  {
    id: 'rip-replace',
    title: 'Rip & Replace',
    description: 'Complete bathroom overhaul - remove everything and install new',
    icon: '🔨',
    details: [
      'Remove all existing fixtures',
      'Strip walls and flooring',
      'Install new plumbing',
      'Complete renovation',
    ],
  },
  {
    id: 'partial-refurb',
    title: 'Partial Refurbishment',
    description: 'Update specific elements while keeping some fixtures',
    icon: '🛠️',
    details: [
      'Selective fixture replacement',
      'Update flooring or tiles',
      'Modernize existing layout',
      'Targeted improvements',
    ],
  },
  {
    id: 'consultation',
    title: 'Consultation Only',
    description: 'Get expert advice and recommendations for your bathroom',
    icon: '💡',
    details: [
      'Expert assessment',
      'Design recommendations',
      'Cost guidance',
      'No commitment',
    ],
  },
];

export function WorkTypeSelector() {
  const { selectWorkType, previousStep } = useSurvey();

  const handleSelectWorkType = (workType: WorkType) => {
    selectWorkType(workType);
  };

  return (
    <div className="survey-step work-type-selector">
      <div className="step-header">
        <h2>What are we doing to your bathroom?</h2>
        <p>Select the type of work you need</p>
      </div>

      <div className="work-types-grid">
        {WORK_TYPES.map((workType) => (
          <button
            key={workType.id}
            onClick={() => handleSelectWorkType(workType.id)}
            className="work-type-card"
          >
            <div className="card-icon">{workType.icon}</div>
            <h3>{workType.title}</h3>
            <p className="card-description">{workType.description}</p>
            <ul className="card-details">
              {workType.details.map((detail, idx) => (
                <li key={idx}>
                  <span className="checkmark">✓</span>
                  {detail}
                </li>
              ))}
            </ul>
            <div className="card-cta">Select this option →</div>
          </button>
        ))}
      </div>

      <div className="step-footer">
        <button onClick={previousStep} className="button button-secondary">
          Back
        </button>
      </div>

      <style jsx>{`
        .survey-step {
          padding: 2rem;
          max-width: 1000px;
          margin: 0 auto;
        }

        .step-header {
          margin-bottom: 3rem;
          text-align: center;
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

        .work-types-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 2rem;
          margin-bottom: 2rem;
        }

        .work-type-card {
          background: white;
          border: 2px solid #e5e7eb;
          border-radius: 12px;
          padding: 2rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .work-type-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
          transition: left 0.5s;
        }

        .work-type-card:hover {
          border-color: #0066cc;
          box-shadow: 0 10px 25px rgba(0, 102, 204, 0.15);
          transform: translateY(-4px);
        }

        .work-type-card:hover::before {
          left: 100%;
        }

        .card-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
          display: block;
        }

        .work-type-card h3 {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 0 0 0.5rem 0;
          color: #1f2937;
        }

        .card-description {
          font-size: 0.95rem;
          color: #6b7280;
          margin: 0 0 1.5rem 0;
          line-height: 1.5;
        }

        .card-details {
          list-style: none;
          padding: 0;
          margin: 0 0 1.5rem 0;
          text-align: left;
        }

        .card-details li {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
          font-size: 0.875rem;
          color: #4b5563;
        }

        .checkmark {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          background: #dbeafe;
          border-radius: 50%;
          color: #0066cc;
          font-weight: 700;
          flex-shrink: 0;
          font-size: 0.75rem;
        }

        .card-cta {
          font-size: 0.875rem;
          font-weight: 600;
          color: #0066cc;
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid #e5e7eb;
        }

        .work-type-card:hover .card-cta {
          color: #0052a3;
        }

        .step-footer {
          display: flex;
          justify-content: flex-start;
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

        .button-secondary {
          background: #f3f4f6;
          color: #374151;
          border: 1px solid #e5e7eb;
        }

        .button-secondary:hover {
          background: #e5e7eb;
        }

        @media (max-width: 768px) {
          .work-types-grid {
            grid-template-columns: 1fr;
          }

          .step-header h2 {
            font-size: 1.5rem;
          }
        }
      `}</style>
    </div>
  );
}
