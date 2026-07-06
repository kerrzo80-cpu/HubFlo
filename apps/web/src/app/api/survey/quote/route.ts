import { NextRequest, NextResponse } from 'next/server';
import type { Quote, WorkType, LidarData } from '@/types/survey';

interface QuoteRequest {
  workType: WorkType;
  lidarData?: LidarData;
}

// Quote generation logic based on work type
function generateQuoteItems(workType: WorkType, lidarData?: LidarData) {
  const area = lidarData?.dimensions?.area || 6; // Default 6 sqm

  const configs = {
    'rip-replace': {
      labour: [
        { task: 'Demolition & removal', hours: area * 1.5, complexity: 'complex' as const },
        { task: 'Plumbing installation', hours: area * 2, complexity: 'complex' as const },
        { task: 'Electrical work', hours: area * 1.5, complexity: 'complex' as const },
        { task: 'Tiling & flooring', hours: area * 3, complexity: 'standard' as const },
        { task: 'Fixture installation', hours: area * 1.5, complexity: 'standard' as const },
      ],
      materials: [
        { name: 'Tiles', category: 'materials', quantity: area * 1.2, unit: 'sqm', cost: 45 },
        { name: 'Flooring', category: 'materials', quantity: area, unit: 'sqm', cost: 50 },
        { name: 'Toilet suite', category: 'fixtures', quantity: 1, unit: 'unit', cost: 400 },
        { name: 'Bath/shower', category: 'fixtures', quantity: 1, unit: 'unit', cost: 800 },
        { name: 'Vanity', category: 'fixtures', quantity: 1, unit: 'unit', cost: 600 },
      ],
    },
    'partial-refurb': {
      labour: [
        { task: 'Selective demolition', hours: area * 0.5, complexity: 'standard' as const },
        { task: 'Surface preparation', hours: area * 1, complexity: 'basic' as const },
        { task: 'Fixture replacement', hours: area * 1.5, complexity: 'standard' as const },
        { task: 'Finishing work', hours: area * 1, complexity: 'basic' as const },
      ],
      materials: [
        { name: 'Paint & finishes', category: 'materials', quantity: area * 0.5, unit: 'sqm', cost: 20 },
        { name: 'Selected fixtures', category: 'fixtures', quantity: 1, unit: 'unit', cost: 800 },
      ],
    },
    'consultation': {
      labour: [
        { task: 'Site assessment', hours: 2, complexity: 'basic' as const },
        { task: 'Design consultation', hours: 3, complexity: 'basic' as const },
        { task: 'Quote preparation', hours: 2, complexity: 'basic' as const },
      ],
      materials: [],
    },
  };

  return configs[workType];
}

export async function POST(request: NextRequest) {
  try {
    const body: QuoteRequest = await request.json();
    const { workType, lidarData } = body;

    if (!workType) {
      return NextResponse.json(
        { error: 'Work type is required' },
        { status: 400 }
      );
    }

    const config = generateQuoteItems(workType, lidarData);

    // Calculate labour
    const labourItems = config.labour.map((item, idx) => ({
      id: `labour-${idx}`,
      task: item.task,
      estimatedHours: Math.round(item.hours * 10) / 10,
      complexity: item.complexity,
      hourlyRate: 75, // Standard rate
    }));

    const totalLabourHours = labourItems.reduce((sum, item) => sum + item.estimatedHours, 0);
    const totalLabourCost = labourItems.reduce((sum, item) => sum + (item.estimatedHours * (item.hourlyRate || 0)), 0);

    // Calculate materials
    const materialItems = config.materials.map((item, idx) => ({
      id: `material-${idx}`,
      name: item.name,
      category: item.category,
      quantity: Math.round(item.quantity * 10) / 10,
      unit: item.unit,
      estimatedUnitCost: item.cost,
    }));

    const totalMaterialsCost = materialItems.reduce((sum, item) => sum + (item.quantity * (item.estimatedUnitCost || 0)), 0);

    // Calculate totals
    const subtotal = totalLabourCost + totalMaterialsCost;
    const markup = 25; // 25% markup
    const total = subtotal * (1 + markup / 100);

    const quote: Quote = {
      id: `quote-${Date.now()}`,
      workType,
      labourItems,
      materialItems,
      totalLabourHours: Math.round(totalLabourHours * 10) / 10,
      totalLabourCost: Math.round(totalLabourCost * 100) / 100,
      totalMaterialsCost: Math.round(totalMaterialsCost * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      markup,
      total: Math.round(total * 100) / 100,
      generatedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      notes: `This is a ${workType === 'rip-replace' ? 'complete bathroom renovation' : workType === 'partial-refurb' ? 'partial bathroom refurbishment' : 'consultation'} quote based on the provided specifications.`,
    };

    return NextResponse.json(quote);
  } catch (error) {
    console.error('Quote generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate quote' },
      { status: 500 }
    );
  }
}
