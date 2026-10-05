This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Firebase Authentication and roles

1. Enable Email/Password sign-in in Firebase Authentication.
2. Create a private Firebase service-account key. Set `FIREBASE_SERVICE_ACCOUNT_JSON` to its JSON on the server, or set `GOOGLE_APPLICATION_CREDENTIALS` to the local key-file path. The local `.env.local` uses the file-path option; save a newly rotated key at the configured path. Never use a `NEXT_PUBLIC_` variable for credentials.
3. Publish `firestore.rules` to the Firebase project. With the Firebase CLI, run `firebase deploy --only firestore:rules` after selecting the correct project; alternatively publish the file in Firebase Console > Firestore Database > Rules.
4. Start the app. The common login page offers Initial Admin Signup only while the authorized `users` collection is empty. Later employees are created inside a manager's portal and use the same login page.

The server routes verify Firebase ID tokens, read the caller's Firestore profile, and enforce role hierarchy before employee or client-assignment writes. Portal pages also verify an httpOnly session cookie and the profile's active status. Firestore client access is restricted to the active assignee, that employee's management chain, and Admin; user profiles cannot be listed or changed from the browser SDK.

Keep the service-account JSON private and rotate it if it is exposed. Existing employee records must be migrated into `users/{uid}` with `uid`, `role`, `status`, `createdBy`, and `permissions`; client records need an `assignedTo` Firebase UID for non-Admin access.

The public entry point redirects to `/login`; protected role portals are served at `/admin/dashboard`, `/sub-admin/dashboard`, `/senior-technical/dashboard`, and `/jn-technical/dashboard`.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
