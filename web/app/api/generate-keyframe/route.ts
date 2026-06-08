import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { optimizePrompt } from '@/lib/prompts';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = body.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Gemini API key required. Add it in Settings.' },
        { status: 400 }
      );
    }

    const prompt =
      body.prompt ||
      optimizePrompt({
        width: body.width || 800,
        height: body.height || 1200,
        theme: body.theme,
        customColor: body.customColor,
        customGeneralPrompt: body.customGeneralPrompt,
      });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: { responseModalities: ['Text', 'Image'] } as never,
    });

    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: 'image/png',
          data: body.imageBase64.replace(/^data:image\/\w+;base64,/, ''),
        },
      },
      {
        text: 'Generate a fully colored anime keyframe image from this manga panel. Output only the transformed illustration.',
      },
    ]);

    const parts = result.response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if ('inlineData' in part && part.inlineData?.data) {
        return NextResponse.json({
          success: true,
          imageBase64: `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`,
          prompt,
        });
      }
    }

    // Fallback: try imagen model
    try {
      const imagen = genAI.getGenerativeModel({ model: 'imagen-3.0-generate-002' });
      const imagenResult = await (imagen as never as {
        generateImages: (opts: { prompt: string; config: { numberOfImages: number } }) => Promise<{
          images: { imageBytes: string }[];
        }>;
      }).generateImages({ prompt, config: { numberOfImages: 1 } });

      if (imagenResult?.images?.[0]?.imageBytes) {
        return NextResponse.json({
          success: true,
          imageBase64: `data:image/png;base64,${imagenResult.images[0].imageBytes}`,
          prompt,
        });
      }
    } catch {
      // continue to manual fallback
    }

    return NextResponse.json({
      success: false,
      error:
        'API image generation unavailable. Use "Open Gemini" panel to generate manually, then upload the result.',
      prompt,
      needsManual: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
