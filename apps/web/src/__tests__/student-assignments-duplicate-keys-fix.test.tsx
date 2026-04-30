import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentAssignmentsPage from '../app/student/assignments/page';

// Mock next-auth
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: {
        id: '536a5c76-0de7-4d6f-8065-e09778566066',
        email: 'kacoucelestin@gmail.com',
        name: 'Kacou Celestin'
      }
    },
    status: 'authenticated'
  })
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('Student Assignments Page - Duplicate Keys Fix', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('should render assignments with unique keys', async () => {
    // Mock API response with unique instance_ids
    const mockAssignments = [
      {
        id: "803f8653-f525-48fd-9311-42243fb4ab59", // instance_id (unique)
        assignment_id: "54aebe62-8029-4483-b012-a9e7ebb1c2cd", // assignment_id (same)
        title: "Devoir 1",
        description: "Devoir 1",
        course: {
          id: "ebe01b85-d543-45a0-b30a-155f0d8ae190",
          name: "Machine Learning et Intelligence Artificielle",
          code: "ML-IA-001"
        },
        instructor: {
          id: "95013ee5-d556-4ab7-b4e3-451a71f1f6a3",
          first_name: null,
          last_name: null
        },
        due_date: "2025-09-28T10:37:00.000Z",
        submitted_at: null,
        status: "expired",
        priority: "high",
        max_points: 100,
        grade: null,
        submission_type: "evaluation",
        feedback: null
      },
      {
        id: "db548a85-c0f4-4f30-a656-18e660faca35", // instance_id (unique)
        assignment_id: "54aebe62-8029-4483-b012-a9e7ebb1c2cd", // assignment_id (same)
        title: "Devoir 1",
        description: "Devoir 1",
        course: {
          id: "ebe01b85-d543-45a0-b30a-155f0d8ae190",
          name: "Machine Learning et Intelligence Artificielle",
          code: "ML-IA-001"
        },
        instructor: {
          id: "95013ee5-d556-4ab7-b4e3-451a71f1f6a3",
          first_name: null,
          last_name: null
        },
        due_date: "2025-12-31T23:59:59.000Z",
        submitted_at: null,
        status: "pending",
        priority: "low",
        max_points: 100,
        grade: null,
        submission_type: "evaluation",
        feedback: null
      }
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: mockAssignments,
        pagination: {
          total: 2,
          limit: 20,
          offset: 0,
          has_more: false
        }
      })
    });

    render(<StudentAssignmentsPage />);

    // Wait for assignments to load
    await screen.findByText('Devoir 1');

    // Verify that both assignments are rendered
    const assignmentCards = screen.getAllByText('Devoir 1');
    expect(assignmentCards).toHaveLength(2);

    // Verify that the API was called with correct headers
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/student/assignments', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': 'imhotepacademy',
'X-User-Id': '536a5c76-0de7-4d6f-8065-e09778566066'
      }
    });
  });

  it('should handle assignments with same assignment_id but different instance_ids', async () => {
    // This test verifies that the fix handles the scenario where
    // multiple assignment instances exist for the same assignment
    const mockAssignments = [
      {
        id: "instance-1", // Different instance_id
        assignment_id: "assignment-123", // Same assignment_id
        title: "Same Assignment",
        description: "Description",
        course: { id: "course-1", name: "Course 1", code: "C1" },
        instructor: { id: "teacher-1", first_name: "John", last_name: "Doe" },
        due_date: "2025-01-01T00:00:00.000Z",
        status: "pending",
        priority: "high",
        max_points: 100,
        submission_type: "online"
      },
      {
        id: "instance-2", // Different instance_id
        assignment_id: "assignment-123", // Same assignment_id
        title: "Same Assignment",
        description: "Description",
        course: { id: "course-1", name: "Course 1", code: "C1" },
        instructor: { id: "teacher-1", first_name: "John", last_name: "Doe" },
        due_date: "2025-01-02T00:00:00.000Z",
        status: "pending",
        priority: "medium",
        max_points: 100,
        submission_type: "online"
      }
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: mockAssignments,
        pagination: { total: 2, limit: 20, offset: 0, has_more: false }
      })
    });

    render(<StudentAssignmentsPage />);

    // Wait for assignments to load
    await screen.findByText('Same Assignment');

    // Verify that both assignments are rendered (no duplicate key error)
    const assignmentCards = screen.getAllByText('Same Assignment');
    expect(assignmentCards).toHaveLength(2);
  });

  it('should display loading state correctly', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<StudentAssignmentsPage />);

    // Should show loading state
    expect(screen.getByText('Enregistrement...')).toBeInTheDocument();
  });

  it('should display error state correctly', async () => {
    mockFetch.mockRejectedValueOnce(new Error('API Error'));

    render(<StudentAssignmentsPage />);

    // Wait for error to appear
    await screen.findByText('Erreur de chargement');
    expect(screen.getByText('API Error')).toBeInTheDocument();
  });
});
