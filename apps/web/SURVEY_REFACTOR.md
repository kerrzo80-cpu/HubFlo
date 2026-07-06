# Survey Flow Refactor Documentation

## Overview

This document outlines the complete refactor of the bathroom survey flow for the Nexa application. The new architecture provides a modular, type-safe, and scalable approach to managing the multi-step survey process.

## Architecture

### Component Structure

```
apps/web/src/
├── components/survey/
│   ├── SurveyFlow.tsx          # Main orchestrator component
│   ├── LidarCapture.tsx         # LIDAR image capture & processing
│   ├── WorkTypeSelector.tsx     # Work type selection interface
│   ├── QuoteDisplay.tsx         # Quote breakdown & display
│   └── index.ts                 # Barrel export
├── context/
│   └── SurveyContext.tsx        # React Context for state management
├── hooks/
│   └── useSurveyState.ts        # Custom hook for survey state logic
├── types/
│   └── survey.ts                # TypeScript type definitions
├── app/
│   ├── survey/
│   │   └── page.tsx             # Survey page entry point
│   └── api/survey/
│       ├── lidar/route.ts       # LIDAR processing API
│       └── quote/route.ts       # Quote generation API
```

### State Management Flow

```
User Input
    ↓
SurveyFlow (Orchestrator)
    ↓
SurveyContext (React Context)
    ↓
useSurveyState (Custom Hook)
    ↓
API Routes (/api/survey/*)
    ↓
Components (LidarCapture, WorkTypeSelector, QuoteDisplay)
```

## Components

### SurveyFlow
**Purpose**: Main orchestrator component that manages step navigation and progress tracking.

**Features**:
- Progress bar showing completion percentage
- Step indicators with visual feedback
- Dynamic step rendering
- Navigation between steps (forward/backward)
- Responsive layout

**Usage**:
```typescript
import { SurveyFlow } from '@/components/survey';

export default function Page() {
  return <SurveyFlow />;
}
```

### LidarCapture
**Purpose**: Handles LIDAR image capture and dimension extraction.

**Features**:
- Image/file upload interface
- Real-time preview
- Loading state management
- Error handling and retry logic
- Dimension display once processed

**API Integration**:
- POST `/api/survey/lidar` - Process LIDAR image and extract dimensions

### WorkTypeSelector
**Purpose**: Allows users to select the type of bathroom work.

**Options**:
1. **Rip & Replace** - Complete bathroom overhaul
2. **Partial Refurbishment** - Update specific elements
3. **Consultation Only** - Expert advice without commitment

**Features**:
- Card-based selection UI
- Detailed descriptions for each option
- Feature lists for each work type
- Hover animations and visual feedback

### QuoteDisplay
**Purpose**: Shows detailed breakdown of labour and materials costs.

**Features**:
- Expandable sections for labour and materials
- Itemized breakdowns with complexity badges
- Summary calculations
- PDF export functionality
- Quote metadata (ID, validity period, notes)

**Tables Display**:
- **Labour**: Tasks, estimated hours, complexity, cost
- **Materials**: Items, category, quantity, cost

## Context & Hooks

### SurveyContext
Provides centralized state management using React Context API.

**Interface**:
```typescript
interface SurveyContextType {
  // Data
  lidarData: LidarData | null;
  workType: WorkType | null;
  quote: Quote | null;
  
  // UI State
  isLoading: boolean;
  error: string | null;
  currentStep: number;
  
  // Methods
  uploadLidarImage(file: File): Promise<void>;
  selectWorkType(type: WorkType): void;
  generateQuote(type: WorkType): Promise<void>;
  nextStep(): void;
  previousStep(): void;
  resetSurvey(): void;
}
```

### useSurveyState Hook
Custom React hook that implements the survey state logic and API interactions.

**Features**:
- Manages all survey data state
- Handles API calls with error management
- Provides loading state for async operations
- Memoized callbacks to prevent unnecessary re-renders

## API Routes

### POST `/api/survey/lidar`
**Purpose**: Process uploaded LIDAR image and extract room dimensions.

**Request**:
```typescript
FormData {
  file: File // Image or point cloud file
}
```

**Response**:
```typescript
{
  imageUrl: string;
  dimensions: {
    length: number;
    width: number;
    height: number;
    area: number;
  };
  capturedAt: string;
  pointCloudUrl?: string;
  metadata?: Record<string, any>;
}
```

### POST `/api/survey/quote`
**Purpose**: Generate a quote based on work type and LIDAR data.

**Request**:
```typescript
{
  workType: 'rip-replace' | 'partial-refurb' | 'consultation';
  lidarData?: LidarData;
}
```

**Response**:
```typescript
{
  id: string;
  workType: WorkType;
  labourItems: LabourItem[];
  materialItems: MaterialItem[];
  totalLabourHours: number;
  totalLabourCost: number;
  totalMaterialsCost: number;
  subtotal: number;
  markup: number;
  total: number;
  generatedAt: string;
  validUntil?: string;
  notes?: string;
}
```

## Type Definitions

### WorkType
```typescript
type WorkType = 'rip-replace' | 'partial-refurb' | 'consultation';
```

### LidarData
```typescript
interface LidarData {
  imageUrl: string;
  dimensions: {
    length: number;
    width: number;
    height: number;
    area: number;
  };
  capturedAt: string;
  pointCloudUrl?: string;
  metadata?: Record<string, any>;
}
```

### Quote
```typescript
interface Quote {
  id: string;
  workType: WorkType;
  labourItems: LabourItem[];
  materialItems: MaterialItem[];
  totalLabourHours: number;
  totalLabourCost: number;
  totalMaterialsCost: number;
  subtotal: number;
  markup: number;
  total: number;
  generatedAt: string;
  validUntil?: string;
  notes?: string;
}
```

## Survey Flow

### Step 1: LIDAR Capture
1. User uploads LIDAR image/point cloud
2. Image is processed to extract room dimensions
3. Dimensions are displayed for verification

### Step 2: Work Type Selection
1. User selects type of work (Rip & Replace, Partial Refurb, or Consultation)
2. Quote generation is triggered automatically

### Step 3: Quote Display
1. Complete quote breakdown is displayed
2. Labour and materials sections are expandable
3. User can export quote as PDF
4. User can go back to modify selections

## Styling

All components use **CSS-in-JS** (styled-jsx) for scoped styling. This approach ensures:
- No CSS conflicts between components
- Responsive design with media queries
- Smooth animations and transitions
- Professional color scheme (blues and grays)

### Key Colors
- Primary: `#0066cc` (Blue)
- Success: `#10b981` (Green)
- Warning: `#ea580c` (Orange)
- Background: `#f5f7fa` (Light Blue-Gray)

## Future Enhancements

1. **Database Integration**
   - Store survey data and quotes in database
   - Add user authentication and survey history
   - Implement quote versioning

2. **Advanced LIDAR Processing**
   - Integrate real computer vision libraries
   - Extract fixture detection
   - Generate 3D room models

3. **Quote Customization**
   - Allow users to modify items and costs
   - Add material/fixture selection
   - Implement discount logic

4. **Analytics & Reporting**
   - Track survey completion rates
   - Analyze quote acceptance rates
   - Generate business insights

5. **Mobile Optimization**
   - Improve mobile camera capture
   - Add touch gestures for interactions
   - Optimize for slow networks

## Development Guidelines

### Adding a New Step
1. Create component in `components/survey/`
2. Add step to `STEPS` array in `SurveyFlow.tsx`
3. Add case to `renderStep()` switch statement
4. Add any new state to `SurveyContextType`
5. Implement in `useSurveyState` hook

### Modifying State
1. Update `SurveyContextType` interface
2. Implement in `useSurveyState` hook
3. Update context provider if needed
4. Update consuming components

### Adding API Routes
1. Create route in `app/api/survey/[endpoint]/route.ts`
2. Add request/response types to `types/survey.ts`
3. Add API call to `useSurveyState` hook
4. Handle loading and error states in components

## Testing Considerations

- Unit test each component in isolation
- Test context provider and hooks
- Mock API responses for integration tests
- E2E tests for complete survey flow
- Test responsive design on various devices
- Test accessibility (keyboard navigation, screen readers)

## Deployment Notes

1. Ensure environment variables are set for API endpoints
2. Configure CORS if APIs are on different domains
3. Set up file upload limits and validation
4. Implement rate limiting on API routes
5. Add monitoring and error logging
6. Consider CDN for image/point cloud storage

## Troubleshooting

### Quote not generating
- Check API endpoint is accessible
- Verify LIDAR data was processed successfully
- Check browser console for API errors
- Ensure work type is selected

### Images not uploading
- Verify file size is within limits
- Check file format is supported
- Ensure form data is being sent correctly
- Check API response for validation errors

### Styling issues
- Clear browser cache
- Check media queries for responsive behavior
- Verify CSS-in-JS is properly scoped
- Check z-index for overlapping elements
