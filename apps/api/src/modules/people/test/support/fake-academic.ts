/**
 * Simulacre du port `AcademicQuery` (le cœur académique n'existe pas encore) : classes, nœuds de curriculum, périodes et
 * offres en mémoire. Sert aux tests des affectations et de la garde d'ouverture d'offre.
 */
import { newId, type RequestContext } from "@ecoledigitale/kernel";
import type { AcademicClassroom, AcademicEnrollment, AcademicNode, AcademicPeriod, AcademicQuery } from "../../application/ports";

export class FakeAcademic implements AcademicQuery {
  readonly classrooms = new Map<string, AcademicClassroom>();
  readonly nodes = new Map<string, AcademicNode>();
  readonly classroomNodes = new Map<string, string[]>();
  readonly periods = new Map<string, AcademicPeriod>();
  readonly offerings = new Map<string, { id: string; classroomId: string; periodId?: string | null; nodeIds: string[] }>();
  readonly enrollmentsByStudent = new Map<string, AcademicEnrollment[]>();

  addNode(over: Partial<AcademicNode> = {}): AcademicNode {
    const node: AcademicNode = { id: newId(), isTransversal: false, isMandatory: true, subjectId: newId(), label: `Matière ${this.nodes.size + 1}`, ...over };
    this.nodes.set(node.id, node);
    return node;
  }

  addClassroom(yearId: string, nodes: AcademicNode[], over: Partial<AcademicClassroom> = {}): AcademicClassroom {
    const classroom: AcademicClassroom = { id: newId(), academicYearId: yearId, status: "ACTIVE", ...over };
    this.classrooms.set(classroom.id, classroom);
    this.classroomNodes.set(classroom.id, nodes.map((n) => n.id));
    return classroom;
  }

  addPeriod(yearId: string): AcademicPeriod {
    const period = { id: newId(), academicYearId: yearId };
    this.periods.set(period.id, period);
    return period;
  }

  async getClassroom(_ctx: RequestContext, classroomId: string) {
    return this.classrooms.get(classroomId) ?? null;
  }
  async getCurriculumNode(_ctx: RequestContext, nodeId: string) {
    return this.nodes.get(nodeId) ?? null;
  }
  async getAcademicPeriod(_ctx: RequestContext, periodId: string) {
    return this.periods.get(periodId) ?? null;
  }
  async listNodesForClassroom(_ctx: RequestContext, classroomId: string) {
    return (this.classroomNodes.get(classroomId) ?? []).map((id) => this.nodes.get(id) as AcademicNode);
  }
  async listClassrooms(_ctx: RequestContext, filter: { academicYearId: string }) {
    return [...this.classrooms.values()].filter((c) => c.academicYearId === filter.academicYearId);
  }
  async getOffering(_ctx: RequestContext, offeringId: string) {
    return this.offerings.get(offeringId) ?? null;
  }
  async listEnrollmentsByStudent(_ctx: RequestContext, studentId: string) {
    return this.enrollmentsByStudent.get(studentId) ?? [];
  }
}
