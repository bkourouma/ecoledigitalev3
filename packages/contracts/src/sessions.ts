export interface Session {
  id: string;
  teacherId: string;
  classId: string;
  courseId: string;
  startDateTime: string; // ISO
  endDateTime: string; // ISO
  notes?: string;
}

export interface SessionCreate {
  classId: string;
  courseId: string;
  startDateTime: string;
  endDateTime: string;
  notes?: string;
}

export interface SessionUpdate {
  startDateTime?: string;
  endDateTime?: string;
  notes?: string;
}


