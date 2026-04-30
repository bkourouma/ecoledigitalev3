'use client';

import { useState } from 'react';

export default function TestLoginPage() {
  const [email, setEmail] = useState('yvonne.checkah@imhotepacademy.com');
  const [password, setPassword] = useState('Imhotep!2025');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const testDirectAPI = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      console.log('🔍 Testing direct API call...');
      
      const response = await fetch('http://localhost:4000/api/v1/auth/login', {
        method: 'POST',
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        body: JSON.stringify({
          email,
          password
        })
      });
      
      const responseText = await response.text();
      
      setResult({
        type: 'direct-api',
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseText,
        success: response.ok
      });
      
    } catch (error: any) {
      setResult({
        type: 'direct-api',
        error: error.message,
        success: false
      });
    }
    
    setLoading(false);
  };

  const testNextAuthAPI = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      console.log('🔍 Testing NextAuth API...');
      
      const response = await fetch('/api/auth/callback/credentials', {
        method: 'POST',
        headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
"X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    },
        body: new URLSearchParams({
          email,
          password,
          redirect: 'false',
          json: 'true',
          callbackUrl: 'http://localhost:3000/login'
        })
      });
      
      const responseText = await response.text();
      
      setResult({
        type: 'nextauth-api',
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseText,
        success: response.ok
      });
      
    } catch (error: any) {
      setResult({
        type: 'nextauth-api',
        error: error.message,
        success: false
      });
    }
    
    setLoading(false);
  };

  const testDatabaseConnection = async () => {
    setLoading(true);
    setResult(null);
    
    try {
      console.log('🔍 Testing database connection...');
      
      const response = await fetch('/api/test-db', {
        method: 'GET'
      });
      
      const responseText = await response.text();
      
      setResult({
        type: 'database-test',
        status: response.status,
        statusText: response.statusText,
        body: responseText,
        success: response.ok
      });
      
    } catch (error: any) {
      setResult({
        type: 'database-test',
        error: error.message,
        success: false
      });
    }
    
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white shadow rounded-lg p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-6">🔧 Test de Connexion - Diagnostic</h1>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          
          <div className="flex flex-wrap gap-4 mb-6">
            <button
              onClick={testDirectAPI}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Test en cours...' : '1. Test API Direct (Port 4000)'}
            </button>
            
            <button
              onClick={testNextAuthAPI}
              disabled={loading}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Test en cours...' : '2. Test NextAuth API'}
            </button>
            
            <button
              onClick={testDatabaseConnection}
              disabled={loading}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              {loading ? 'Test en cours...' : '3. Test Base de Données'}
            </button>
          </div>
          
          {result && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-3 flex items-center">
                {result.success ? '✅' : '❌'} Résultat du test: {result.type}
              </h3>
              
              <div className="space-y-3">
                {result.status && (
                  <div>
                    <strong>Status:</strong> {result.status} {result.statusText}
                  </div>
                )}
                
                {result.headers && (
                  <div>
                    <strong>Headers:</strong>
                    <pre className="bg-gray-100 p-2 rounded text-xs overflow-auto">
                      {JSON.stringify(result.headers, null, 2)}
                    </pre>
                  </div>
                )}
                
                {result.body && (
                  <div>
                    <strong>Response Body:</strong>
                    <pre className="bg-gray-100 p-2 rounded text-xs overflow-auto">
                      {result.body}
                    </pre>
                  </div>
                )}
                
                {result.error && (
                  <div>
                    <strong>Error:</strong>
                    <pre className="bg-red-100 p-2 rounded text-xs text-red-800">
                      {result.error}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
