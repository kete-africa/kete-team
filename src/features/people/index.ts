// The roster's only door: what the rest of the app may use.
export { peopleCapabilities, reads, useReadsEveryone } from './capabilities';
export { useLeaveCheck } from './commands/people';
export { peopleEvents } from './events';
export { authorisationHoldings } from './holdings';
export { peoplePermissions } from './policies';
export {
  authorisationsOf,
  expiringWithin,
  findMember,
  knownProjects,
  listAssignments,
  listMembers,
  noteMember,
  peopleMigrationSql,
} from './infrastructure/people.table';
export type { Assignment, Authorisation, Kind, Member } from './people.record';
