import { redirect } from 'next/navigation';

// /admin/users retired in 0020 Phase 4 — folded into /admin/people. Kept as
// a redirect for one transitional release so any bookmarks / muscle memory
// land on the new page. Delete in a future cleanup chunk.
export default function UsersAdminPage(): never {
  redirect('/admin/people');
}
