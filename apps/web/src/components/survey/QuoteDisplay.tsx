'use client';

import React, { useState } from 'react';
import { useSurvey } from '@/context/SurveyContext';

export function QuoteDisplay() {
  const { quote, isLoading, error, previousStep } = useSurvey();
  const [expandedSection, setExpandedSection] = useState<'labour' | 'materials' | null>(null);

  if (!quote) {
    return (
      <div className="quote-loading">
        <p>No quote available. Please complete the survey first.</p>
      </div>
    );
  }

  const handleExport = () => {
    // Generate PDF export
    const content = generateQuoteContent();
    const blob = new Blob([content], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quote-${quote.id}.pdf`;
    a.click();
  };

  const generateQuoteContent = () => {
    // Placeholder for PDF generation
    return 'PDF Content';
  };

  return (
    <div className="survey-step quote-display">
      <div className="step-header">
        <h2>Your Quote</h2>
        <p>Detailed breakdown of labour and materials</p>
      </div>

      {error && (
        <div className="error-message">
          <span>⚠️</span>
          <p>{error}</p>
        </div>
      )}

      {isLoading && (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Generating your quote...</p>
        </div>
      )}

      {!isLoading && (
        <div className="quote-content">
          {/* Quote Header */}
          <div className="quote-header">
            <div className="header-info">
              <p className="quote-id">Quote #{quote.id.slice(-8)}</p>
              <p className="quote-type">
                {quote.workType === 'rip-replace'
                  ? 'Rip & Replace'
                  : quote.workType === 'partial-refurb'
                    ? 'Partial Refurbishment'
                    : 'Consultation'}
              </p>
            </div>
            <div className="header-dates">
              <p>
                <strong>Generated:</strong> {new Date(quote.generatedAt).toLocaleDateString()}
              </p>
              {quote.validUntil && (
                <p>
                  <strong>Valid until:</strong>{' '}
                  {new Date(quote.validUntil).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          {/* Labour Section */}
          <div className="quote-section">
            <button
              className="section-header"
              onClick={() =>
                setExpandedSection(expandedSection === 'labour' ? null : 'labour')
              }
            >
              <h3>Labour</h3>
              <span className="section-total">
                ${quote.totalLabourCost.toLocaleString()}
              </span>
              <span className="expand-icon">
                {expandedSection === 'labour' ? '▼' : '▶'}
              </span>
            </button>

            {expandedSection === 'labour' && (
              <div className="section-details">
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Hours</th>
                      <th>Complexity</th>
                      <th className="text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.labourItems.map((item) => (
                      <tr key={item.id}>
                        <td className="task-name">{item.task}</td>
                        <td>{item.estimatedHours}h</td>
                        <td>
                          <span className={`badge badge-${item.complexity}`}>
                            {item.complexity}
                          </span>
                        </td>
                        <td className="text-right">
                          ${((item.estimatedHours * (item.hourlyRate || 0)).toFixed(2)).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="section-summary">
                  <p>
                    <strong>Total Hours:</strong> {quote.totalLabourHours}h
                  </p>
                  <p>
                    <strong>Total Labour Cost:</strong> $
                    {quote.totalLabourCost.toLocaleString()}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Materials Section */}
          <div className="quote-section">
            <button
              className="section-header"
              onClick={() =>
                setExpandedSection(expandedSection === 'materials' ? null : 'materials')
              }
            >
              <h3>Materials</h3>
              <span className="section-total">
                ${quote.totalMaterialsCost.toLocaleString()}
              </span>
              <span className="expand-icon">
                {expandedSection === 'materials' ? '▼' : '▶'}
              </span>
            </button>

            {expandedSection === 'materials' && (
              <div className="section-details">
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Category</th>
                      <th>Qty</th>
                      <th className="text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.materialItems.map((item) => (
                      <tr key={item.id}>
                        <td className="task-name">{item.name}</td>
                        <td>
                          <span className="category-badge">{item.category}</span>
                        </td>
                        <td>
                          {item.quantity} {item.unit}
                        </td>
                        <td className="text-right">
                          ${((item.quantity * (item.estimatedUnitCost || 0)).toFixed(2)).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="section-summary">
                  <p>
                    <strong>Total Materials Cost:</strong> $
                    {quote.totalMaterialsCost.toLocaleString()}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Summary Section */}
          <div className="quote-summary">
            <div className="summary-row">
              <span>Subtotal</span>
              <span>${quote.subtotal.toLocaleString()}</span>
            </div>
            <div className="summary-row">
              <span>Markup ({quote.markup}%)</span>
              <span>
                ${((quote.subtotal * quote.markup) / 100).toFixed(2).toLocaleString()}
              </span>
            </div>
            <div className="summary-row total">
              <span>Total</span>
              <span>${quote.total.toLocaleString()}</span>
            </div>
          </div>

          {quote.notes && (
            <div className="quote-notes">
              <h4>Notes</h4>
              <p>{quote.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="step-footer">
        <button onClick={previousStep} className="button button-secondary">
          Back
        </button>
        <button onClick={handleExport} className="button button-primary">
          Export as PDF
        </button>
      </div>

      <style jsx>{`
        .survey-step {
          padding: 2rem;
          max-width: 900px;
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
          margin-bottom: 2rem;
        }

        .error-message span {
          font-size: 1.25rem;
          flex-shrink: 0;
        }

        .loading-spinner {
          text-align: center;
          padding: 3rem 2rem;
        }

        .spinner {
          display: inline-block;
          width: 40px;
          height: 40px;
          border: 4px solid #e5e7eb;
          border-top-color: #0066cc;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .loading-spinner p {
          margin-top: 1rem;
          color: #6b7280;
        }

        .quote-content {
          background: white;
          border-radius: 12px;
          padding: 2rem;
          margin-bottom: 2rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .quote-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: 2rem;
          border-bottom: 1px solid #e5e7eb;
          margin-bottom: 2rem;
        }

        .quote-id {
          font-size: 0.875rem;
          color: #6b7280;
          margin: 0;
        }

        .quote-type {
          font-size: 1.125rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0.5rem 0 0 0;
        }

        .header-dates {
          text-align: right;
          font-size: 0.875rem;
          color: #6b7280;
        }

        .header-dates p {
          margin: 0.25rem 0;
        }

        .quote-section {
          margin-bottom: 1.5rem;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          overflow: hidden;
        }

        .section-header {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.25rem;
          background: #f9fafb;
          border: none;
          cursor: pointer;
          transition: background 0.2s;
        }

        .section-header:hover {
          background: #f3f4f6;
        }

        .section-header h3 {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 600;
          color: #1f2937;
          flex: 1;
          text-align: left;
        }

        .section-total {
          font-size: 1.25rem;
          font-weight: 700;
          color: #0066cc;
          margin: 0 1rem;
        }

        .expand-icon {
          font-size: 0.75rem;
          color: #9ca3af;
        }

        .section-details {
          padding: 1.5rem;
          background: white;
        }

        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 1.5rem;
        }

        .items-table thead {
          background: #f9fafb;
        }

        .items-table th {
          padding: 0.75rem;
          text-align: left;
          font-size: 0.875rem;
          font-weight: 600;
          color: #6b7280;
          border-bottom: 1px solid #e5e7eb;
        }

        .items-table td {
          padding: 0.75rem;
          border-bottom: 1px solid #f3f4f6;
          font-size: 0.875rem;
          color: #374151;
        }

        .task-name {
          font-weight: 500;
          color: #1f2937;
        }

        .text-right {
          text-align: right;
        }

        .badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: capitalize;
        }

        .badge-basic {
          background: #dbeafe;
          color: #0369a1;
        }

        .badge-standard {
          background: #dcfce7;
          color: #16a34a;
        }

        .badge-complex {
          background: #fed7aa;
          color: #ea580c;
        }

        .category-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          background: #f0f9ff;
          color: #0369a1;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: capitalize;
        }

        .section-summary {
          padding-top: 1rem;
          border-top: 1px solid #e5e7eb;
          font-size: 0.875rem;
        }

        .section-summary p {
          margin: 0.5rem 0;
          color: #374151;
        }

        .quote-summary {
          background: #f9fafb;
          border-radius: 8px;
          padding: 1.5rem;
          margin: 2rem 0;
        }

        .summary-row {
          display: flex;
          justify-content: space-between;
          padding: 0.75rem 0;
          font-size: 1rem;
          color: #374151;
          border-bottom: 1px solid #e5e7eb;
        }

        .summary-row:last-child {
          border-bottom: none;
        }

        .summary-row.total {
          font-size: 1.25rem;
          font-weight: 700;
          color: #1f2937;
          padding: 1rem 0;
          margin-top: 0.5rem;
          padding-top: 1rem;
          border-top: 2px solid #e5e7eb;
        }

        .summary-row span:last-child {
          font-weight: 600;
          color: #0066cc;
        }

        .summary-row.total span:last-child {
          color: #059669;
        }

        .quote-notes {
          background: #eff6ff;
          border-left: 4px solid #0066cc;
          padding: 1rem;
          border-radius: 4px;
          margin-bottom: 2rem;
        }

        .quote-notes h4 {
          margin: 0 0 0.5rem 0;
          color: #1f2937;
          font-size: 0.875rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .quote-notes p {
          margin: 0;
          color: #374151;
          font-size: 0.875rem;
          line-height: 1.5;
        }

        .step-footer {
          display: flex;
          justify-content: space-between;
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

        .button-secondary {
          background: #f3f4f6;
          color: #374151;
          border: 1px solid #e5e7eb;
        }

        .button-secondary:hover {
          background: #e5e7eb;
        }
      `}</style>
    </div>
  );
}
