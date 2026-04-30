"use client";

import { useSession } from 'next-auth/react';

export default function TestLayoutPage() {
  const { data: session, status } = useSession();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Test Layout Page</h1>
      
      <div className="space-y-4">
        <div>
          <strong>Status:</strong> {status}
        </div>
        
        <div>
          <strong>Has Session:</strong> {session ? 'Yes' : 'No'}
        </div>
        
        {session && (
          <div>
            <strong>User:</strong> {session.user?.name || session.user?.email}
          </div>
        )}
        
        <div>
          <strong>Session Data:</strong>
          <pre className="bg-gray-100 p-4 rounded mt-2 text-sm overflow-auto">
            {JSON.stringify(session, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}










