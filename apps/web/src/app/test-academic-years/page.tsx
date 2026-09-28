"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DatePickerFr from "@/components/DatePickerFr";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const API = "";

export default function TestAcademicYearsPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [ay, setAy] = useState({
    id: "",
    name: "Année Test 2024-2025",
    startDate: "2024-09-01",
    endDate: "2025-06-30",
  });

  const log = (line: string) => setResult((prev) => prev + line + "\n");
  const clear = () => setResult("");

  const headers = {
    "Content-Type": "application/json",
    "X-Tenant": "imhotepacademy",
  } as const;

  const testList = async () => {
    setLoading(true); log("GET /api/v1/academic-years");
    try {
      const res = await fetch(`${API}/api/v1/academic-years?includeStats=true`, { headers });
      log(`STATUS: ${res.status}`);
      log(await res.text());
    } catch (e) {
      log(`ERROR: ${e}` as any);
    } finally { setLoading(false); }
  };

  const testCreate = async () => {
    setLoading(true); log("POST /api/v1/academic-years");
    try {
      const res = await fetch(`${API}/api/v1/academic-years`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: ay.name, startDate: ay.startDate, endDate: ay.endDate }),
      });
      log(`STATUS: ${res.status}`);
      const txt = await res.text(); log(txt);
      try { const json = JSON.parse(txt); setAy((s) => ({ ...s, id: json?.data?.id || s.id })); } catch {}
    } catch (e) { log(`ERROR: ${e}` as any); } finally { setLoading(false); }
  };

  const testUpdate = async () => {
    if (!ay.id) { log("Set id first (create or paste)"); return; }
    setLoading(true); log(`PUT /api/v1/academic-years/${ay.id}`);
    try {
      const res = await fetch(`${API}/api/v1/academic-years/${ay.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ name: ay.name, startDate: ay.startDate, endDate: ay.endDate }),
      });
      log(`STATUS: ${res.status}`);
      log(await res.text());
    } catch (e) { log(`ERROR: ${e}` as any); } finally { setLoading(false); }
  };

  const testSetActive = async () => {
    if (!ay.id) { log("Set id first (create or paste)"); return; }
    setLoading(true); log(`POST /api/v1/academic-years/${ay.id}/set-active`);
    try {
      const res = await fetch(`${API}/api/v1/academic-years/${ay.id}/set-active`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      log(`STATUS: ${res.status}`);
      log(await res.text());
    } catch (e) { log(`ERROR: ${e}` as any); } finally { setLoading(false); }
  };

  const testDelete = async () => {
    if (!ay.id) { log("Set id first (create or paste)"); return; }
    setLoading(true); log(`DELETE /api/v1/academic-years/${ay.id}`);
    try {
      const res = await fetch(`${API}/api/v1/academic-years/${ay.id}`, {
        method: "DELETE",
        headers,
      });
      log(`STATUS: ${res.status}`);
      log(await res.text());
    } catch (e) { log(`ERROR: ${e}` as any); } finally { setLoading(false); }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="font-bold mb-6 whitespace-nowrap text-2xl leading-tight md:text-3xl">Academic Years API Test</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Données de test</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="id">ID (pour update/delete/set-active)</Label>
              <Input id="id" value={ay.id} onChange={(e) => setAy({ ...ay, id: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="name">Nom</Label>
              <Input id="name" value={ay.name} onChange={(e) => setAy({ ...ay, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="start">Début</Label>
                <DatePickerFr id="start" value={ay.startDate} onChange={(iso) => setAy({ ...ay, startDate: iso })} />
              </div>
              <div>
                <Label htmlFor="end">Fin</Label>
                <DatePickerFr id="end" value={ay.endDate} onChange={(iso) => setAy({ ...ay, endDate: iso })} />
              </div>
            </div>
            <div className="space-y-2">
              <Button onClick={testList} disabled={loading} className="w-full">Test LIST</Button>
              <Button onClick={testCreate} disabled={loading} className="w-full">Test CREATE</Button>
              <Button onClick={testUpdate} disabled={loading} className="w-full">Test UPDATE</Button>
              <Button onClick={testSetActive} disabled={loading} className="w-full">Test SET ACTIVE</Button>
              <Button onClick={testDelete} disabled={loading} className="w-full" variant="destructive">Test DELETE</Button>
              <Button onClick={clear} className="w-full" variant="outline">Clear</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Résultats</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-gray-100 p-4 rounded overflow-auto h-96 text-sm">{result || 'No tests run yet...'}</pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

