import { NextResponse } from 'next/server';
import { optimizePrompt } from '@/lib/prompts';

export async function POST(req: Request) {
  const body = await req.json();
  const prompt = optimizePrompt({
    width: body.width || 800,
    height: body.height || 1200,
    theme: body.theme,
    customColor: body.customColor,
    customGeneralPrompt: body.customGeneralPrompt,
  });
  return NextResponse.json({ prompt });
}
