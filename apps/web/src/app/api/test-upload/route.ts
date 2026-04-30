import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  console.log('🧪 Test upload endpoint hit');
  
  try {
    // Log request details
    console.log('📋 Request details:', {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries())
    });

    // Try to parse form data
    let formData;
    try {
      formData = await request.formData();
      console.log('📦 Form data received:', {
        hasFile: formData.has('file'),
        fileCount: Array.from(formData.keys()).length,
        keys: Array.from(formData.keys())
      });
    } catch (error) {
      console.error('❌ Failed to parse form data:', error);
      return NextResponse.json(
        { success: false, error: 'Invalid form data', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 400 }
      );
    }

    // Check if file exists
    const file = formData.get('file') as File;
    if (!file || !(file instanceof File)) {
      console.error('❌ No valid file found');
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    console.log('📁 File details:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    return NextResponse.json({
      success: true,
      message: 'Test upload successful',
      file: {
        name: file.name,
        size: file.size,
        type: file.type
      }
    });

  } catch (error) {
    console.error('❌ Test upload error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Test upload endpoint is working',
    timestamp: new Date().toISOString()
  });
}
