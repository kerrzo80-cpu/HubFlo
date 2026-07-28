export default function EngineerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <style>{`
        .engineer-brand-bar {
          align-items: center;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(88, 172, 213, 0.18);
          border-radius: 22px;
          box-shadow: 0 10px 30px rgba(40, 126, 168, 0.09);
          color: #124f70;
          display: flex;
          gap: 12px;
          left: 18px;
          padding: 10px 14px 10px 10px;
          position: fixed;
          right: 18px;
          top: 12px;
          z-index: 20;
        }

        .engineer-brand-bar img {
          background: #fff;
          border: 1px solid rgba(88, 172, 213, 0.18);
          border-radius: 14px;
          height: 42px;
          object-fit: contain;
          padding: 4px 7px;
          width: 76px;
        }

        .engineer-brand-copy {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .engineer-brand-copy strong {
          font-size: 15px;
          letter-spacing: -0.02em;
          line-height: 1.1;
        }

        .engineer-brand-copy span {
          color: #4d7b90;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.08em;
          margin-top: 2px;
          text-transform: uppercase;
        }

        .engineer-shell {
          background:
            radial-gradient(circle at 10% 0%, rgba(88, 172, 213, 0.28), transparent 28rem),
            radial-gradient(circle at 100% 18%, rgba(219, 242, 250, 0.92), transparent 24rem),
            linear-gradient(145deg, #f8fdff 0%, #eaf6fb 54%, #f4fbfd 100%) !important;
          padding-top: 88px !important;
        }

        .engineer-hero,
        .engineer-job-detail-hero {
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.96) 0%, rgba(233, 247, 252, 0.96) 52%, rgba(206, 235, 247, 0.96) 100%) !important;
          border: 1px solid rgba(88, 172, 213, 0.24) !important;
          box-shadow: 0 18px 44px rgba(40, 126, 168, 0.16) !important;
          color: var(--blue-deep) !important;
        }

        .engineer-hero::after,
        .engineer-job-detail-hero::after {
          background: rgba(88, 172, 213, 0.16) !important;
        }

        .engineer-hero .eyebrow,
        .engineer-job-detail-hero .eyebrow {
          color: var(--blue-dark) !important;
        }

        .engineer-hero h1,
        .engineer-job-detail-hero h1 {
          color: #124f70 !important;
        }

        .engineer-hero p,
        .engineer-job-detail-hero p {
          color: #456d7e !important;
        }

        .engineer-summary-grid div,
        .engineer-detail-meta span {
          background: rgba(255, 255, 255, 0.74) !important;
          border: 1px solid rgba(88, 172, 213, 0.22) !important;
          color: var(--blue-deep) !important;
        }

        .engineer-summary-grid span {
          color: #4d7b90 !important;
        }

        .engineer-primary-action,
        .engineer-po-form button,
        .engineer-outcome-bar button {
          background: linear-gradient(135deg, var(--blue) 0%, var(--blue-deep) 100%) !important;
          box-shadow: 0 10px 24px rgba(40, 126, 168, 0.18) !important;
        }

        .engineer-secondary-action,
        .engineer-timeline,
        .engineer-panel,
        .engineer-contact-card,
        .engineer-job-card {
          border-color: rgba(88, 172, 213, 0.18) !important;
          box-shadow: 0 10px 30px rgba(40, 126, 168, 0.09) !important;
        }

        .engineer-time-block {
          background: linear-gradient(180deg, #effaff 0%, #dff3fb 100%) !important;
        }

        .engineer-outcome-bar button:nth-child(3) {
          background: linear-gradient(135deg, #287ea8 0%, #17698f 100%) !important;
        }

        .engineer-gap-options {
          grid-template-columns: 1fr !important;
        }

        .engineer-gap-options button {
          min-height: 54px !important;
          padding: 0 16px !important;
        }

        @media (max-width: 620px) {
          .engineer-brand-bar {
            left: 12px;
            right: 12px;
            top: 10px;
          }

          .engineer-brand-bar img {
            height: 38px;
            width: 68px;
          }
        }

        .blake-character {
          display: inline-flex;
          line-height: 0;
          pointer-events: none;
          user-select: none;
        }

        .blake-character-stage {
          aspect-ratio: 1 / 1;
          display: block;
          position: relative;
          width: 100%;
        }

        .blake-character.size-sm { width: 44px; }
        .blake-character.size-md { width: 60px; }
        .blake-character.size-lg { width: 84px; }
        .blake-character.size-hero { width: 120px; }

        .blake-character .blake-pose {
          display: block;
          filter: drop-shadow(0 8px 14px rgba(17, 52, 68, 0.14));
          height: 100%;
          object-fit: contain;
          width: 100%;
        }

        .blake-time-hero-row {
          align-items: flex-start;
          display: flex;
          gap: 16px;
        }

        .blake-chat-log {
          display: grid;
          gap: 12px;
          margin-top: 8px;
        }

        .blake-chat-bubble {
          align-items: flex-start;
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid rgba(88, 172, 213, 0.18);
          border-radius: 18px;
          display: flex;
          gap: 10px;
          padding: 12px 14px;
        }

        .blake-chat-bubble.you {
          background: rgba(40, 126, 168, 0.08);
          margin-left: 28px;
        }

        .blake-chat-bubble p {
          color: #124f70;
          font-size: 14px;
          line-height: 1.45;
          margin: 0;
        }

        .blake-time-actions,
        .blake-current-job {
          display: grid;
          gap: 10px;
          margin-top: 14px;
        }

        .blake-current-job {
          background: rgba(88, 172, 213, 0.1);
          border-radius: 16px;
          padding: 12px 14px;
        }

        .blake-current-job strong,
        .blake-current-job span {
          display: block;
        }

        .blake-current-job span {
          color: #4d7b90;
          font-size: 13px;
          margin-top: 4px;
        }

        .engineer-programme-board {
          display: grid;
          gap: 12px;
          margin-bottom: 18px;
        }

        .engineer-programme-legend {
          align-items: baseline;
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }

        .engineer-programme-legend span {
          color: #4d7b90;
          font-size: 12px;
          font-weight: 700;
        }

        .engineer-programme-track {
          background:
            linear-gradient(90deg, rgba(88, 172, 213, 0.08) 0%, rgba(88, 172, 213, 0.18) 50%, rgba(88, 172, 213, 0.08) 100%);
          border: 1px solid rgba(88, 172, 213, 0.2);
          border-radius: 18px;
          height: 74px;
          overflow: hidden;
          position: relative;
        }

        .engineer-programme-bar {
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(40, 126, 168, 0.22);
          border-radius: 14px;
          box-shadow: 0 8px 18px rgba(40, 126, 168, 0.12);
          display: grid;
          gap: 2px;
          min-width: 72px;
          padding: 8px 10px;
          position: absolute;
          top: 12px;
        }

        .engineer-programme-bar.active {
          background: linear-gradient(135deg, #287ea8 0%, #17698f 100%);
          color: #fff;
        }

        .engineer-programme-bar strong,
        .engineer-programme-bar span {
          display: block;
          font-size: 11px;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .engineer-programme-bar span {
          opacity: 0.85;
        }
      `}</style>
      <header className="engineer-brand-bar" aria-label="NeXa engineer app">
        <img src="/brand/nexa-command-mark.svg" alt="" aria-hidden="true" />
        <div className="engineer-brand-copy">
          <strong>NeXa</strong>
          <span>Field command</span>
        </div>
      </header>
      {children}
    </>
  );
}
