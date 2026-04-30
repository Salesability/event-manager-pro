import { bigint, index, pgEnum, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { actors, archivable, bigIdentity, timestamps } from './_columns';
import { contacts } from './contacts';

export const teamMemberRole = pgEnum('team_member_role', [
  'admin',
  'staff',
  'coach',
  'viewer',
]);

export const teamMemberRoles = pgTable(
  'team_member_roles',
  {
    id: bigIdentity(),
    contactId: bigint('contact_id', { mode: 'number' })
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    role: teamMemberRole('role').notNull(),
    specialty: text('specialty'),
    ...timestamps,
    ...actors,
    ...archivable,
  },
  (table) => [
    uniqueIndex('team_member_roles_contact_id_role_unique').on(table.contactId, table.role),
    index('team_member_roles_contact_id_idx').on(table.contactId),
    index('team_member_roles_created_by_id_idx').on(table.createdById),
    index('team_member_roles_updated_by_id_idx').on(table.updatedById),
  ]
);
