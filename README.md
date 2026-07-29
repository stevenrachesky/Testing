# Testing
A test repo for a ton of things

Added a line to test `fetch`

## Draft Time Poll

A tiny static web app for the league to pick a fantasy draft time. It shows a table
of candidate dates/times (Aug 16 – Sep 8, 2026 — 6:00 PM on weekdays, 3:00 PM and
6:00 PM on weekends) with one column per league member. Everyone marks the slots
that don't work for them, and the app highlights which times are still open to
everyone.

Files: `index.html`, `style.css`, `app.js`, `firebase-config.js`.

### Try it locally (no setup required)

Open `index.html` in a browser (or serve the folder with e.g. `python3 -m http.server`).
Without a Firebase project configured, the app automatically saves answers to your
browser's `localStorage` only — good enough to try the UI, but not shared with anyone else.
You'll see a yellow banner reminding you of this.

### Enable shared, real-time results (Firebase)

1. Go to the [Firebase console](https://console.firebase.google.com/), create a free
   project, then add a **Web app** to it.
2. Copy the `firebaseConfig` object it gives you into `firebase-config.js` in this repo,
   replacing the placeholder values.
3. In the Firebase console, open **Firestore Database** and create a database
   (any region, start in the default locked mode).
4. Under **Firestore Database → Rules**, replace the rules with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /responses/{name} {
         allow read: if true;
         allow write: if name in [
           'Steven', 'Shiv', 'Harry', 'Oliver', 'Henry', 'Miles',
           'James', 'Zach', 'Max', 'Will', 'Graham', 'David'
         ];
       }
     }
   }
   ```

   This keeps results readable by anyone with the link, while only allowing writes to
   one of the 12 known roster names — fine for a small trusted league; tighten further
   (e.g. with Firebase Auth) if you want stronger protection.
5. Publish the rules, then host the folder anywhere that serves static files (GitHub
   Pages, Netlify, Vercel, etc.) and share the link with the league. Everyone picks
   their name from the "Who are you?" dropdown and taps cells in their own column to
   mark times that don't work — results update live for everyone.
