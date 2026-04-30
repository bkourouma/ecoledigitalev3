"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Calendar from "@/components/schedule/Calendar";
import SessionDetails from "@/components/schedule/SessionDetails";
import { Card, CardContent, CardHeader, CardTitle, Button } from "@ecoledigitale/ui";
import AddSessionDialog from "@/components/schedule/AddSessionDialog";

type ApiSession = {
  id: string;
  classId: string;
  courseId: string;
  startDateTime: string;
  endDateTime: string;
  notes?: string;
};

export default function TeacherSchedulePage() {
  const [sessions, setSessions] = useState<ApiSession[]>([]);

  const fetchSessions = useCallback(async () => {
    const url = `/api/v1/sessions?start=${encodeURIComponent(new Date(Date.now()-7*864e5).toISOString())}&end=${encodeURIComponent(new Date(Date.now()+21*864e5).toISOString())}`;
    const res = await fetch(url, { headers: { 'x-tenant': 'default' } });
    if (res.ok) {
      const json = await res.json();
      setSessions(json.data || []);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const events = useMemo(() => sessions.map(s => ({
    id: s.id,
    title: s.notes || 'Session',
    start: new Date(s.startDateTime),
    end: new Date(s.endDateTime),
    classId: s.classId,
    courseId: s.courseId,
  })), [sessions]);

  const onMove = async (id: string, newStart: Date, newEnd: Date) => {
    const res = await fetch(`/api/v1/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-tenant': 'default' },
      body: JSON.stringify({ startDateTime: newStart.toISOString(), endDateTime: newEnd.toISOString() })
    });
    if (!res.ok) throw new Error('Conflict or error while moving');
    await fetchSessions();
  };

  const onResize = async (id: string, newEnd: Date) => {
    const res = await fetch(`/api/v1/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-tenant': 'default' },
      body: JSON.stringify({ endDateTime: newEnd.toISOString() })
    });
    if (!res.ok) throw new Error('Conflict or error while resizing');
    await fetchSessions();
  };

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Mon Emploi du Temps</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-2 gap-2">
            <AddSessionDialog onCreated={fetchSessions} />
            <Button onClick={fetchSessions} size="sm">Rafraîchir</Button>
          </div>
          <Calendar events={events} onMove={onMove} onResize={onResize} />
          {/* Simple details launcher for the first event as example; integrate per-event in Calendar later */}
          {events[0] && (
            <div className="mt-2">
              <SessionDetails id={events[0].id} initialNotes={events[0].title} onUpdated={fetchSessions} onDeleted={fetchSessions} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


