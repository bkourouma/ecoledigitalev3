import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  console.log('🧪 Test download route called');
  
  try {
    // Test 1: Basic response
    console.log('✅ Route is accessible');
    
    // Test 2: Request parsing
    let body;
    try {
      body = await request.json();
      console.log('✅ Request body parsed:', body);
    } catch (error) {
      console.error('❌ Request body parsing failed:', error);
      return NextResponse.json(
        { success: false, error: 'Request body parsing failed', details: error.message },
        { status: 400 }
      );
    }
    
    // Test 3: Headers
    const headers = Object.fromEntries(request.headers.entries());
    console.log('📋 Request headers:', headers);
    
    // Test 4: Environment
    console.log('🌍 Environment:', {
      NODE_ENV: process.env.NODE_ENV,
      API_BASE_URL: process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : process.env.API_URL
    });
    
    // Test 5: Simple backend test (without auth)
    const API_BASE_URL = process.env.NODE_ENV === 'development' 
      ? 'http://localhost:4000' 
      : process.env.API_URL || 'http://localhost:4000';
    
    try {
      console.log('🔗 Testing backend connectivity...');
      const healthResponse = await fetch(`${API_BASE_URL}/health`, {
        method: 'GET',
        headers: {
          'User-Agent': 'NextJS-Test/1.0',
        },
      });
      
      console.log('🏥 Backend health check:', {
        status: healthResponse.status,
        statusText: healthResponse.statusText,
        ok: healthResponse.ok
      });
      
      if (healthResponse.ok) {
        const healthData = await healthResponse.text();
        console.log('✅ Backend is running:', healthData);
      } else {
        console.error('❌ Backend health check failed');
      }
    } catch (backendError) {
      console.error('❌ Backend connectivity error:', backendError);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Backend non accessible',
          details: backendError.message,
          backendUrl: API_BASE_URL
        },
        { status: 503 }
      );
    }
    
    // Return success with debug info
    return NextResponse.json({
      success: true,
      message: 'Test route working',
      debug: {
        requestBody: body,
        headers: headers,
        environment: process.env.NODE_ENV,
        backendUrl: API_BASE_URL,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Test route error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Erreur interne du serveur',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: true,
    message: 'Test download route is accessible via GET',
    timestamp: new Date().toISOString()
  });
}
