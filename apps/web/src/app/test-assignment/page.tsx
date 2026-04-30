"use client";

import { useStudentAssignment } from "@/lib/hooks/use-student-data";

export default function TestAssignmentPage() {
  const { data: assignmentData, isLoading, error } = useStudentAssignment("a348ebcc-c061-44e8-a740-20f214b39960");

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error.message}</div>;
  }

  return (
    <div>
      <h1>Test Assignment Page</h1>
      <pre>{JSON.stringify(assignmentData, null, 2)}</pre>
    </div>
  );
}














