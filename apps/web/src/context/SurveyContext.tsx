'use client';

import React, { createContext, useContext } from 'react';
import { useSurveyState } from '@/hooks/useSurveyState';
import type { SurveyContextType } from '@/types/survey';

const SurveyContext = createContext<SurveyContextType | undefined>(undefined);

export function SurveyProvider({ children }: { children: React.ReactNode }) {
  const surveyState = useSurveyState();

  return (
    <SurveyContext.Provider value={surveyState}>
      {children}
    </SurveyContext.Provider>
  );
}

export function useSurvey() {
  const context = useContext(SurveyContext);
  if (context === undefined) {
    throw new Error('useSurvey must be used within a SurveyProvider');
  }
  return context;
}
