'use client';

import { useState, useCallback } from 'react';
import type {
  SurveyState,
  SurveyContextType,
  LidarData,
  RoomDimensions,
  WorkType,
  BathroomRefurbAnswers,
  Quote,
} from '@/types/survey';

const initialState: SurveyState = {
  currentStep: 'lidar',
  completedSteps: [],
  isLoading: false,
};

export function useSurveyState(): SurveyContextType {
  const [state, setState] = useState<SurveyState>(initialState);

  // LIDAR: Upload and process image
  const uploadLidarImage = useCallback(
    async (file: File): Promise<LidarData> => {
      setState((prev) => ({ ...prev, isLoading: true, error: undefined }));
      try {
        // TODO: Integrate with actual LIDAR API
        // For now, we'll create a mock implementation
        const formData = new FormData();
        formData.append('file', file);

        // This would call your LIDAR processing API
        // const response = await fetch('/api/lidar/process', {
        //   method: 'POST',
        //   body: formData,
        // });

        // Mock response for now
        const mockLidarData: LidarData = {
          id: `lidar-${Date.now()}`,
          capturedAt: new Date(),
          imageUrl: URL.createObjectURL(file),
          dimensions: {
            length: 2.5,
            width: 2.0,
            height: 2.4,
            area: 5.0,
          },
        };

        setState((prev) => ({
          ...prev,
          lidarData: mockLidarData,
          completedSteps: [...new Set([...prev.completedSteps, 'lidar'])],
          isLoading: false,
        }));

        return mockLidarData;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to process LIDAR image';
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
        throw error;
      }
    },
    []
  );

  // Update room dimensions (manual override if needed)
  const updateDimensions = useCallback((dimensions: RoomDimensions) => {
    setState((prev) => ({
      ...prev,
      lidarData: prev.lidarData
        ? { ...prev.lidarData, dimensions }
        : {
            id: `lidar-${Date.now()}`,
            capturedAt: new Date(),
            imageUrl: '',
            dimensions,
          },
    }));
  }, []);

  // Select work type and move to questions
  const selectWorkType = useCallback((workType: WorkType) => {
    setState((prev) => ({
      ...prev,
      workType,
      completedSteps: [...new Set([...prev.completedSteps, 'work-type'])],
      currentStep: 'questions',
    }));
  }, []);

  // Update survey answers
  const updateAnswers = useCallback((answers: Partial<BathroomRefurbAnswers>) => {
    setState((prev) => ({
      ...prev,
      answers: {
        ...prev.answers,
        ...answers,
      } as BathroomRefurbAnswers,
    }));
  }, []);

  // Generate quote from answers
  const generateQuote = useCallback(async (): Promise<Quote> => {
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));
    try {
      // TODO: Call AI quote generation API
      // const response = await fetch('/api/quote/generate', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     lidarId: state.lidarData?.id,
      //     answers: state.answers,
      //     workType: state.workType,
      //   }),
      // });

      // Mock quote generation
      const mockQuote: Quote = {
        id: `quote-${Date.now()}`,
        projectId: `project-${Date.now()}`,
        lidarId: state.lidarData?.id || '',
        workType: state.workType || 'rip-replace',

        labourItems: [
          {
            id: 'labour-1',
            task: 'Demolition and removal',
            estimatedHours: 16,
            hourlyRate: 45,
            complexity: 'standard',
          },
          {
            id: 'labour-2',
            task: 'Plumbing installation',
            estimatedHours: 20,
            hourlyRate: 55,
            complexity: 'complex',
          },
          {
            id: 'labour-3',
            task: 'Tiling and finishing',
            estimatedHours: 24,
            hourlyRate: 50,
            complexity: 'standard',
          },
        ],
        totalLabourHours: 60,
        totalLabourCost: 2750,

        materialItems: [
          {
            id: 'mat-1',
            name: 'Toilet Suite',
            category: 'fixtures',
            quantity: 1,
            unit: 'unit',
            estimatedUnitCost: 350,
          },
          {
            id: 'mat-2',
            name: 'Vanity Sink',
            category: 'fixtures',
            quantity: 1,
            unit: 'unit',
            estimatedUnitCost: 250,
          },
          {
            id: 'mat-3',
            name: 'Shower Enclosure',
            category: 'fixtures',
            quantity: 1,
            unit: 'unit',
            estimatedUnitCost: 450,
          },
          {
            id: 'mat-4',
            name: 'Ceramic Wall Tiles (m²)',
            category: 'materials',
            quantity: 10,
            unit: 'm²',
            estimatedUnitCost: 45,
          },
          {
            id: 'mat-5',
            name: 'Porcelain Floor Tiles (m²)',
            category: 'materials',
            quantity: 5,
            unit: 'm²',
            estimatedUnitCost: 65,
          },
          {
            id: 'mat-6',
            name: 'Adhesive & Grout',
            category: 'supplies',
            quantity: 20,
            unit: 'kg',
            estimatedUnitCost: 12,
          },
          {
            id: 'mat-7',
            name: 'Copper Pipes & Fittings',
            category: 'supplies',
            quantity: 1,
            unit: 'kit',
            estimatedUnitCost: 180,
          },
        ],
        totalMaterialsCost: 2730,

        subtotal: 5480,
        markup: 15,
        total: 6302,

        generatedAt: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      };

      setState((prev) => ({
        ...prev,
        quote: mockQuote,
        completedSteps: [...new Set([...prev.completedSteps, 'quote'])],
        currentStep: 'quote',
        isLoading: false,
      }));

      return mockQuote;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to generate quote';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      throw error;
    }
  }, [state.lidarData?.id, state.answers, state.workType]);

  // Navigation
  const goToStep = useCallback(
    (step: SurveyState['currentStep']) => {
      setState((prev) => ({
        ...prev,
        currentStep: step,
      }));
    },
    []
  );

  const nextStep = useCallback(() => {
    setState((prev) => {
      const steps: SurveyState['currentStep'][] = [
        'lidar',
        'dimensions',
        'work-type',
        'questions',
        'quote',
        'review',
      ];
      const currentIndex = steps.indexOf(prev.currentStep);
      const nextStep = steps[currentIndex + 1];

      return {
        ...prev,
        currentStep: nextStep || prev.currentStep,
      };
    });
  }, []);

  const previousStep = useCallback(() => {
    setState((prev) => {
      const steps: SurveyState['currentStep'][] = [
        'lidar',
        'dimensions',
        'work-type',
        'questions',
        'quote',
        'review',
      ];
      const currentIndex = steps.indexOf(prev.currentStep);
      const prevStep = steps[currentIndex - 1];

      return {
        ...prev,
        currentStep: prevStep || prev.currentStep,
      };
    });
  }, []);

  // Reset entire survey
  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    ...state,
    uploadLidarImage,
    updateDimensions,
    selectWorkType,
    updateAnswers,
    generateQuote,
    goToStep,
    nextStep,
    previousStep,
    reset,
  };
}
