# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Survey Flow Refactor (feature/nexa-survey-refactor)
- **New SurveyFlow Component**: Main orchestrator component with progress tracking and step navigation
  - Progress bar showing completion percentage
  - Step indicators with visual feedback
  - Dynamic step rendering based on survey state
  - Responsive design for mobile and desktop

- **LIDAR Capture Component**: Image upload and room dimension extraction
  - File upload interface with drag-and-drop support
  - Real-time image preview
  - API integration for LIDAR processing
  - Loading and error state management
  - Dimension display and verification

- **Work Type Selector Component**: Selection interface for bathroom refurbishment type
  - Three work type options: Rip & Replace, Partial Refurbishment, Consultation
  - Card-based UI with detailed descriptions
  - Feature lists for each option
  - Hover animations and visual feedback

- **Quote Display Component**: Detailed quote breakdown and visualization
  - Expandable sections for labour and materials
  - Itemized breakdowns with complexity badges
  - Summary calculations and totals
  - PDF export functionality
  - Quote metadata display (ID, validity period, notes)

- **Survey Context & State Management**: React Context-based state management
  - `SurveyContext` for centralized state
  - `useSurvey()` hook for component integration
  - `useSurveyState()` custom hook for state logic

- **Type Definitions**: Comprehensive TypeScript types
  - `WorkType`: Union type for work type options
  - `LidarData`: LIDAR image and dimension data
  - `Quote`: Complete quote structure
  - `SurveyContextType`: Context interface
  - `LabourItem` & `MaterialItem`: Quote item types

- **API Routes**: Backend endpoints for survey processing
  - `POST /api/survey/lidar`: LIDAR image processing and dimension extraction
  - `POST /api/survey/quote`: Quote generation based on work type and LIDAR data

- **Documentation**: Comprehensive documentation for the survey flow refactor
  - Architecture overview
  - Component documentation
  - API endpoint specifications
  - Type definitions
  - Development guidelines
  - Troubleshooting guide

### Changed

- Refactored survey flow from monolithic to modular component architecture
- Improved type safety with comprehensive TypeScript interfaces
- Enhanced state management with React Context API
- Improved responsive design and mobile UX
- Better error handling and user feedback

### Technical Details

- **Language**: TypeScript with React 18+
- **Styling**: CSS-in-JS (styled-jsx) for component scoping
- **State Management**: React Context API + Custom Hooks
- **API Framework**: Next.js App Router
- **File Upload**: FormData API for file handling

### Files Added

```
apps/web/src/
├── components/survey/
│   ├── SurveyFlow.tsx
│   ├── LidarCapture.tsx
│   ├── WorkTypeSelector.tsx
│   ├── QuoteDisplay.tsx
│   └── index.ts
├── context/
│   └── SurveyContext.tsx
├── hooks/
│   └── useSurveyState.ts
├── types/
│   └── survey.ts
├── app/
│   ├── survey/
│   │   └── page.tsx
│   └── api/survey/
│       ├── lidar/route.ts
│       └── quote/route.ts
└── SURVEY_REFACTOR.md
```

### Future Enhancements

- [ ] Database integration for survey history
- [ ] User authentication and personalization
- [ ] Advanced LIDAR processing with computer vision
- [ ] Fixture detection and automatic cost estimation
- [ ] Quote customization UI
- [ ] PDF generation library integration
- [ ] Analytics and reporting dashboard
- [ ] Mobile app integration

## Notes for Reviewers

1. All components use TypeScript for type safety
2. API routes include mock data - replace with actual implementations
3. Styling uses CSS-in-JS for scoped, maintainable styles
4. Components are fully responsive and mobile-friendly
5. Error handling and loading states are implemented throughout
6. Documentation includes development guidelines and troubleshooting

---

## Previous Releases

(Previous changelog entries would go here)
