"use client";

import { useState, useEffect } from "react";
import { signIn, getSession, signOut } from "next-auth/react";
import { saveToken, getToken, removeToken, decodeToken } from "@/lib/jwt-storage";

export default function TestAuthPage() {
  const [email, setEmail] = useState("admin@imhotepacademy.fr");
  const [password, setPassword] = useState("Passw0rd!admin");
  const [logs, setLogs] = useState<string[]>([]);
  const [session, setSession] = useState<any>(null);
  const [localStorage, setLocalStorageValue] = useState<string | null>(null);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${message}`]);
    console.log(message);
  };

  const checkSession = async () => {
    addLog("🔍 Checking session...");
    const sess = await getSession();
    setSession(sess);
    if (sess) {
      addLog(`✅ Session found: ${JSON.stringify(sess, null, 2)}`);
    } else {
      addLog("❌ No session found");
    }
  };

  const checkLocalStorage = () => {
    addLog("🔍 Checking localStorage...");
    const token = getToken();
    setLocalStorageValue(token);
    if (token) {
      addLog(`✅ JWT token found in localStorage`);
      const decoded = decodeToken(token);
      if (decoded) {
        addLog(`   User ID: ${decoded.userId}`);
        addLog(`   Email: ${decoded.sub}`);
        addLog(`   Roles: ${decoded.roles?.join(", ")}`);
        addLog(`   Expires: ${new Date(decoded.exp! * 1000).toLocaleString()}`);
      }
    } else {
      addLog("❌ No JWT token in localStorage");
    }
  };

  const testBackendLogin = async () => {
    addLog("🔐 Testing backend login directly...");
    try {
      const response = await fetch("http://localhost:4000/api/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant": "imhotepacademy",
        },
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json();
      if (response.ok) {
        addLog(`✅ Backend login successful!`);
        addLog(`   User: ${result.user.email}`);
        addLog(`   Token present: ${!!result.token}`);
        if (result.token) {
          addLog("💾 Saving token to localStorage...");
          saveToken(result.token);
          checkLocalStorage();
        }
      } else {
        addLog(`❌ Backend login failed: ${result.error || result.message}`);
      }
    } catch (error: any) {
      addLog(`❌ Backend request error: ${error.message}`);
    }
  };

  const testNextAuthLogin = async () => {
    addLog("🔐 Testing NextAuth login...");
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        addLog(`❌ NextAuth login failed: ${result.error}`);
      } else {
        addLog("✅ NextAuth login successful!");
        
        // Wait a bit for session to be created
        await new Promise(resolve => setTimeout(resolve, 500));
        
        addLog("🔍 Getting session after login...");
        const sess = await getSession();
        
        if (sess) {
          addLog(`✅ Session created`);
          addLog(`   User: ${sess.user?.email}`);
          addLog(`   JWT token in session: ${!!(sess as any).jwtToken}`);
          
          if ((sess as any).jwtToken) {
            addLog("💾 Saving JWT token to localStorage...");
            saveToken((sess as any).jwtToken);
            checkLocalStorage();
          } else {
            addLog("⚠️  No JWT token in session - this is the problem!");
          }
        } else {
          addLog("❌ No session created - this is the problem!");
        }
      }
    } catch (error: any) {
      addLog(`❌ NextAuth login error: ${error.message}`);
    }
  };

  const clearAuth = () => {
    addLog("🧹 Clearing authentication...");
    removeToken();
    signOut({ redirect: false });
    setSession(null);
    setLocalStorageValue(null);
    addLog("✅ Auth cleared");
  };

  useEffect(() => {
    addLog("📱 Test Auth Page loaded");
    checkSession();
    checkLocalStorage();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-bold mb-6 whitespace-nowrap text-2xl leading-tight md:text-3xl">🔐 JWT Authentication Diagnostic</h1>
        
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Login Credentials</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Actions</h2>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={testBackendLogin}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              1️⃣ Test Backend Login
            </button>
            <button
              onClick={testNextAuthLogin}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              2️⃣ Test NextAuth Login
            </button>
            <button
              onClick={checkSession}
              className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              🔍 Check Session
            </button>
            <button
              onClick={checkLocalStorage}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
            >
              💾 Check localStorage
            </button>
            <button
              onClick={clearAuth}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 col-span-2"
            >
              🧹 Clear All Auth
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Current State</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold mb-2">Session:</h3>
              <pre className="bg-gray-100 p-3 rounded text-xs overflow-auto max-h-40">
                {session ? JSON.stringify(session, null, 2) : "No session"}
              </pre>
            </div>
            <div>
              <h3 className="font-semibold mb-2">localStorage Token:</h3>
              <pre className="bg-gray-100 p-3 rounded text-xs overflow-auto max-h-40 break-all">
                {localStorage || "No token"}
              </pre>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Activity Log</h2>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-xs space-y-1 max-h-96 overflow-auto">
            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}










