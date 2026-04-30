import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Test de connexion à la base de données via l'API backend
    const apiUrl = "";
    
    console.log('Testing database connection via API:', apiUrl);
    
    const response = await fetch(`${apiUrl}/api/v1/health`, {
      method: 'GET',
      headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    }
    });
    
    const responseText = await response.text();
    
    return NextResponse.json({
      success: response.ok,
      status: response.status,
      apiUrl,
      response: responseText,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('Database test error:', error);
    
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
