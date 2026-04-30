'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DatePickerFr from "@/components/DatePickerFr";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TestPaymentPeriodsPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const [formData, setFormData] = useState({
    name: 'Test Period January 2024',
    description: 'Test payment period for January 2024',
    periodStart: '2024-01-01',
    periodEnd: '2024-01-31',
  });

  const testGetPeriods = async () => {
    setLoading(true);
    setResult('Testing GET /api/v1/payment-periods...\n');
    
    try {
      console.log('🔄 Testing GET payment periods...');
      
      const response = await fetch('/api/v1/payment-periods', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': 'imhotepacademy',
          'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
        },
      });
      
      console.log('📡 GET Response status:', response.status);
      console.log('📡 GET Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ GET Success:', data);
        setResult(prev => prev + `GET SUCCESS: ${JSON.stringify(data, null, 2)}\n\n`);
      } else {
        const errorText = await response.text();
        console.error('❌ GET Error:', response.status, errorText);
        setResult(prev => prev + `GET ERROR ${response.status}: ${errorText}\n\n`);
      }
    } catch (error) {
      console.error('💥 GET Network Error:', error);
      setResult(prev => prev + `GET NETWORK ERROR: ${error}\n\n`);
    } finally {
      setLoading(false);
    }
  };

  const testCreatePeriod = async () => {
    setLoading(true);
    setResult(prev => prev + 'Testing POST /api/v1/payment-periods...\n');
    
    try {
      console.log('🔄 Testing CREATE payment period...');
      console.log('📤 Request data:', formData);
      
      const response = await fetch('/api/v1/payment-periods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': 'imhotepacademy',
          'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
        },
        body: JSON.stringify(formData),
      });
      
      console.log('📡 POST Response status:', response.status);
      console.log('📡 POST Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ POST Success:', data);
        setResult(prev => prev + `POST SUCCESS: ${JSON.stringify(data, null, 2)}\n\n`);
      } else {
        const errorText = await response.text();
        console.error('❌ POST Error:', response.status, errorText);
        setResult(prev => prev + `POST ERROR ${response.status}: ${errorText}\n\n`);
      }
    } catch (error) {
      console.error('💥 POST Network Error:', error);
      setResult(prev => prev + `POST NETWORK ERROR: ${error}\n\n`);
    } finally {
      setLoading(false);
    }
  };

  const testWithAuth = async () => {
    setLoading(true);
    setResult(prev => prev + 'Testing with authentication...\n');
    
    try {
      // First get session
      const sessionResponse = await fetch('/api/auth/session');
      const session = await sessionResponse.json();
      console.log('🔐 Session:', session);
      setResult(prev => prev + `SESSION: ${JSON.stringify(session, null, 2)}\n\n`);
      
      // Then try to create period with session
      const response = await fetch('/api/v1/payment-periods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': 'imhotepacademy',
          'X-User-Id': '634a57fe-2007-4ecb-ae5b-f9e3152a24fb',
        },
        body: JSON.stringify(formData),
      });
      
      console.log('📡 AUTH POST Response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ AUTH POST Success:', data);
        setResult(prev => prev + `AUTH POST SUCCESS: ${JSON.stringify(data, null, 2)}\n\n`);
      } else {
        const errorText = await response.text();
        console.error('❌ AUTH POST Error:', response.status, errorText);
        setResult(prev => prev + `AUTH POST ERROR ${response.status}: ${errorText}\n\n`);
      }
    } catch (error) {
      console.error('💥 AUTH Network Error:', error);
      setResult(prev => prev + `AUTH NETWORK ERROR: ${error}\n\n`);
    } finally {
      setLoading(false);
    }
  };

  const clearResults = () => {
    setResult('');
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Payment Periods API Test</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Test Form */}
        <Card>
          <CardHeader>
            <CardTitle>Test Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Period Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="periodStart">Start Date</Label>
                <DatePickerFr
                  id="periodStart"
                  value={formData.periodStart}
                  onChange={(iso) => setFormData({ ...formData, periodStart: iso })}
                />
              </div>
              <div>
                <Label htmlFor="periodEnd">End Date</Label>
                <DatePickerFr
                  id="periodEnd"
                  value={formData.periodEnd}
                  onChange={(iso) => setFormData({ ...formData, periodEnd: iso })}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Button onClick={testGetPeriods} disabled={loading} className="w-full">
                Test GET Periods
              </Button>
              <Button onClick={testCreatePeriod} disabled={loading} className="w-full">
                Test CREATE Period
              </Button>
              <Button onClick={testWithAuth} disabled={loading} className="w-full">
                Test with Auth
              </Button>
              <Button onClick={clearResults} variant="outline" className="w-full">
                Clear Results
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader>
            <CardTitle>Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-gray-100 p-4 rounded overflow-auto h-96 text-sm">
              {result || 'No tests run yet...'}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
