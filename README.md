# Professional Tax Partner CRM

## Firebase client setup

1. Create a Firebase web app and copy its web configuration to `.env.local` using the `NEXT_PUBLIC_FIREBASE_*` names in `.env.example`. These values are web-app configuration, not service-account credentials.
2. Enable Email/Password authentication in Firebase Authentication.
3. Create the Firestore database and publish [`firestore.rules`](./firestore.rules). For example, select the correct Firebase project and run `firebase deploy --only firestore:rules`, or publish the file in Firebase Console > Firestore Database > Rules.
4. When no Admin account exists, the `/login` page automatically presents the "Create Initial Admin" signup option. The first signup creates the Admin account and atomically initializes `system/bootstrap`; all subsequent public Admin signup attempts are permanently disabled.
5. Start the app with `npm run dev`. Employees are provisioned in the Admin portal and sign in through the same `/login` page.

## Data access and roles

The browser uses Firebase Authentication and the Firebase Web SDK directly. User profiles and CRM records live in Firestore; there are no Admin SDK credentials, server session cookies, or Firebase-backed API routes. `firestore.rules` is the authorization boundary for all reads and writes, including direct navigation to role dashboards.

The role hierarchy is Admin, Sub Admin, Social Media, Senior Technical, then JN Technical. Employee creation and employee management are limited to lower roles in the caller's reporting hierarchy. Sub Admins may assign or reassign clients to any active Social Media, Senior Technical, or JN Technical employee, including employees outside their own reporting branch; their client, payment, and related service views include records assigned to those roles. Social Media sits directly below Sub Admin: an Admin or Sub Admin creates those accounts, and a Social Media user can assign or reassign clients to any active Senior Technical or JN Technical employee but cannot create or edit employees (its default permissions are `manage_clients` and `manage_assignments`). Senior Technical assignment scope remains limited to their own hierarchy. Team membership uses `managerUid` and falls back to `createdBy` for legacy profiles. Deactivating a Firestore user profile immediately blocks data access through the rules. Employee password resets use Firebase's email reset flow because the client SDK cannot set another user's password. Login email changes are not performed by managers because the Firebase client SDK cannot change another user's Authentication identity.

Employee reads are query-shaped. A Sub Admin and a Social Media user are scoped by role rather than by the reporting chain, but the rules cannot inspect a list query, so `firestore.rules` only allows the exact queries the app builds: the team list (`role in` the technical roles plus `status == 'active'`) and the Admin-only employee directory (`role in` every role). The full employee list is returned in both cases — there is no `limit`, and adding one on either side would make the query and `isTeamListQuery`/`isEmployeeListQuery` disagree. Those clauses live in `teamListQuery()` and `getDirectoryProfiles()` in `app/lib/crm-data.js`, and Firestore rejects any `in` filter built from an empty array, so role lists are never assembled from data that can be empty. A mismatched filter makes the read fail, and the Team view then reports that the list could not load instead of showing it as empty.

Existing Firebase Authentication users need a corresponding `users/{uid}` profile. Existing profiles should have `uid`, `name`, `email`, `role`, `status`, `createdBy`, and `permissions`; set `managerUid` to define the reporting hierarchy. Existing client records should have `assignedTo` set to a Firebase user UID for team-scoped access. Publish the new Firestore Rules only after verifying/migrating existing profiles and records.

The public entry point redirects to `/login`; the protected role dashboards are `/admin/dashboard`, `/sub-admin/dashboard`, `/social-media/dashboard`, `/senior-technical/dashboard`, and `/jn-technical/dashboard`.
