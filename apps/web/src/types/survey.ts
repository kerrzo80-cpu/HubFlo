// Survey type definitions for the Nexa bathroom survey flow

export type WorkType = 'rip-replace' | 'partial-refurb' | 'consultation';

export interface RoomDimensions {
  length: number; // meters
  width: number; // meters
  height: number; // meters
  area: number; // square meters (calculated)
}

export interface LidarData {
  id: string;
  capturedAt: Date;
  imageUrl: string;
  dimensions: RoomDimensions;
  rawData?: unknown;
}

export type BathroomFixture = 'toilet' | 'sink' | 'bath' | 'shower' | 'bidet';
export type MaterialQuality = 'basic' | 'standard' | 'premium' | 'luxury';

export interface BathroomRefurbAnswers {
  // Work scope
  workType: WorkType;
  
  // Fixtures
  removedFixtures: BathroomFixture[];
  newFixtures: BathroomFixture[];
  
  // Materials
  materialQuality: MaterialQuality;
  tileType?: string;
  flooringType?: string;
  
  // Special requirements
  accessibility?: boolean;
  heating?: boolean;
  ventilation?: boolean;
  specialRequirements?: string;
  
  // Timeline & budget
  timeline?: string;
  budget?: number;
}

export interface MaterialLineItem {
  id: string;
  name: string;
  category: 'fixtures' | 'materials' | 'supplies' | 'equipment';
  quantity: number;
  unit: string;
  estimatedUnitCost?: number;
  notes?: string;
}

export interface LabourLineItem {
  id: string;
  task: string;
  estimatedHours: number;
  hourlyRate?: number;
  complexity: 'basic' | 'standard' | 'complex';
}

export interface Quote {
  id: string;
  projectId: string;
  lidarId: string;
  workType: WorkType;
  
  // Labour breakdown
  labourItems: LabourLineItem[];
  totalLabourHours: number;
  totalLabourCost: number;
  
  // Materials breakdown
  materialItems: MaterialLineItem[];
  totalMaterialsCost: number;
  
  // Summary
  subtotal: number;
  markup: number; // percentage
  total: number;
  
  // Metadata
  generatedAt: Date;
  validUntil?: Date;
  notes?: string;
}

export interface SurveyState {
  // Progress
  currentStep: 'lidar' | 'dimensions' | 'work-type' | 'questions' | 'quote' | 'review';
  completedSteps: string[];
  
  // Data
  lidarData?: LidarData;
  workType?: WorkType;
  answers?: BathroomRefurbAnswers;
  quote?: Quote;
  
  // UI state
  isLoading: boolean;
  error?: string;
}

export interface SurveyContextType extends SurveyState {
  // LIDAR
  uploadLidarImage: (file: File) => Promise<LidarData>;
  updateDimensions: (dimensions: RoomDimensions) => void;
  
  // Work flow
  selectWorkType: (workType: WorkType) => void;
  updateAnswers: (answers: Partial<BathroomRefurbAnswers>) => void;
  
  // Quote
  generateQuote: () => Promise<Quote>;
  
  // Navigation
  goToStep: (step: SurveyState['currentStep']) => void;
  nextStep: () => void;
  previousStep: () => void;
  
  // Cleanup
  reset: () => void;
}
