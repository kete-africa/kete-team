import { z } from 'zod';

// The roster, described once: members, the kinds of authorisations, what each person holds, what
// each project requires, who is assigned where.

const id = z.string().min(1).max(64);
const day = z.iso.date();

export const memberInput = z.object({
  /** Her Compte Kete account: what every app knows her by. */
  userId: id,
  name: z.string().trim().min(1).max(200),
  joinedOn: day.optional(),
});

export const kindInput = z.object({ name: z.string().trim().min(1).max(120) });

export const authorisationInput = z.object({
  userId: id,
  kindId: id,
  validFrom: day,
  /** The last day it is valid; none when it never expires. */
  validUntil: day.optional(),
  /** The proof: the certificate's number, who delivered it. */
  proof: z.string().trim().max(200).optional(),
});

export const requirementsInput = z.object({
  projectId: id,
  /** Every kind whoever is assigned to this project must hold; an empty list requires nothing. */
  kindIds: z.array(id).max(30),
});

export const assignmentInput = z.object({
  userId: id,
  projectId: id,
  startsOn: day,
  endsOn: day,
  role: z.string().trim().max(120).optional(),
});

export const assignmentEnd = z.object({ assignmentId: id, endsOn: day });

export interface Member {
  userId: string;
  name: string;
  joinedOn: string | null;
  active: boolean;
}

export interface Kind {
  kindId: string;
  name: string;
}

export interface Authorisation {
  authorisationId: string;
  userId: string;
  memberName: string;
  kindId: string;
  kindName: string;
  validFrom: string;
  validUntil: string | null;
  proof: string | null;
}

export interface Assignment {
  assignmentId: string;
  userId: string;
  memberName: string;
  projectId: string;
  projectName: string;
  role: string | null;
  startsOn: string;
  endsOn: string;
}
