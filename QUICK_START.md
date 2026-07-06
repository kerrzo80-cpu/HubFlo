# Survey Flow - Quick Start Guide

## Installation

1. **Checkout the feature branch**
```bash
git checkout feature/nexa-survey-refactor
```

2. **Install dependencies** (if needed)
```bash
npm install
# or
yarn install
```

3. **Configure environment variables**
Create `.env.local` in the root directory:
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
MAX_UPLOAD_SIZE=50M
DEFAULT_MARKUP_PERCENT=25
LABOUR_HOURLY_RATE=75
```

4. **Run development server**
```bash
npm run dev
# or
yarn dev
```

5. **Access the survey**
Navigate to: `http://localhost:3000/survey`

## Project Structure

```
apps/web/src/
├── components/survey/
│   ├── SurveyFlow.tsx          # Main component
│   ├── LidarCapture.tsx        # Step 1: Upload image
│   ├── WorkTypeSelector.tsx    # Step 2: Select work type
│   ├── QuoteDisplay.tsx        # Step 3: View quote
│   └── index.ts                # Exports
├── context/
│   └── SurveyContext.tsx       # State management
├── hooks/
│   └── useSurveyState.ts       # State logic
├── types/
│   └── survey.ts               # TypeScript types
├── app/
│   ├── survey/page.tsx         # Survey page
│   └── api/survey/
│       ├── lidar/route.ts      # LIDAR API
│       └── quote/route.ts      # Quote API
└── SURVEY_REFACTOR.md          # Full documentation
```

## Component Usage

### Using SurveyFlow
```typescript
import { SurveyFlow } from '@/components/survey';

export default function Page() {
  return <SurveyFlow />;
}
```

### Accessing Survey State
```typescript
import { useSurvey } from '@/context/SurveyContext';

export function MyComponent() {
  const { workType, quote, selectWorkType } = useSurvey();
  
  return (
    <button onClick={() => selectWorkType('rip-replace')}>
      Select Rip & Replace
    </button>
  );
}
```

## API Endpoints

### Upload LIDAR Image
```bash
curl -X POST http://localhost:3000/api/survey/lidar \
  -F "file=@bathroom.jpg"
```

Response:
```json
{
  "imageUrl": "blob:...",
  "dimensions": {
    "length": 3.5,
    "width": 2.5,
    "height": 2.4,
    "area": 8.75
  },
  "capturedAt": "2026-07-06T08:00:00Z"
}
```

### Generate Quote
```bash
curl -X POST http://localhost:3000/api/survey/quote \
  -H "Content-Type: application/json" \
  -d '{
    "workType": "rip-replace",
    "lidarData": {"dimensions": {"area": 8.75}}
  }'
```

Response:
```json
{
  "id": "quote-1720249200000",
  "workType": "rip-replace",
  "totalLabourCost": 1237.5,
  "totalMaterialsCost": 1945,
  "subtotal": 3182.5,
  "markup": 25,
  "total": 3978.125,
  "generatedAt": "2026-07-06T08:00:00Z",
  "validUntil": "2026-08-05T08:00:00Z"
}
```

## Survey Flow Steps

### Step 1: LIDAR Capture
- User uploads image or point cloud file
- System processes and extracts dimensions
- User can verify dimensions before proceeding

### Step 2: Work Type Selection
- User selects refurbishment type:
  - **Rip & Replace**: Complete renovation
  - **Partial Refurbishment**: Selective updates
  - **Consultation**: Design advice only
- Quote generation is triggered automatically

### Step 3: Quote Display
- Labour breakdown with hourly estimates
- Materials breakdown with quantities
- Total cost calculation with markup
- PDF export option

## Styling

All components use **CSS-in-JS** (styled-jsx) with:
- Responsive breakpoints (768px mobile)
- Color scheme: Blues (#0066cc) and Grays (#f5f7fa)
- Animations and transitions
- Accessible color contrast

## Testing

### Manual Testing
1. Navigate to `/survey`
2. Upload a test image (any JPEG/PNG)
3. Select a work type
4. Review the generated quote
5. Test navigation back/forward

### Common Issues

**Issue**: "Failed to process LIDAR image"
- Check file size (max 50MB)
- Verify file format (image/* or .ply/.obj)
- Check browser console for errors

**Issue**: "Failed to generate quote"
- Ensure LIDAR image was processed first
- Check `/api/survey/quote` endpoint
- Verify request body contains `workType`

**Issue**: Styling not appearing
- Clear browser cache
- Restart dev server
- Check styled-jsx is properly configured

## Configuration

### Modify Default Settings

In `useSurveyState.ts`:
```typescript
const generateQuote = useCallback(async (type: WorkType) => {
  // Adjust API endpoint
  const response = await fetch('/api/survey/quote', {
    // ...
  });
}, [lidarData]);
```

In `apps/web/src/app/api/survey/quote/route.ts`:
```typescript
const markup = 25; // Change markup percentage
const hourlyRate = 75; // Change labour rate
```

## Performance Tips

1. **Image Optimization**: Compress images before upload
2. **Lazy Loading**: Components are already optimized
3. **Caching**: Implement React Query for API caching
4. **Code Splitting**: SurveyFlow is a dynamic component

## Next Steps

1. **Add Tests**: Create test files for components
2. **Database**: Connect to backend for data persistence
3. **Authentication**: Integrate user authentication
4. **PDF Export**: Implement PDF generation
5. **Analytics**: Add event tracking

## Resources

- [Full Documentation](./apps/web/SURVEY_REFACTOR.md)
- [Implementation Checklist](./IMPLEMENTATION_CHECKLIST.md)
- [Type Definitions](./apps/web/src/types/survey.ts)
- [Changelog](./CHANGELOG.md)

## Support

For issues or questions:
1. Check the [Troubleshooting Guide](./apps/web/SURVEY_REFACTOR.md#troubleshooting)
2. Review component source code
3. Check browser console for errors
4. Verify environment variables are set

---

**Branch**: `feature/nexa-survey-refactor`

**Last Updated**: 2026-07-06
