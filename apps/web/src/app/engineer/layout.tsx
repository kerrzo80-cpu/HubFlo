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
      `}</style>
      <header className="engineer-brand-bar" aria-label="Errol Watson Group engineer app">
        <img src="/ewg-logo.png" alt="Errol Watson Group" />
        <div className="engineer-brand-copy">
          <strong>Errol Watson Group</strong>
          <span>Engineer HubFlo</span>
        </div>
      </header>
      {children}
    </>
  );
}
