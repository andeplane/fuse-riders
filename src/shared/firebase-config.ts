/**
 * The Firebase web app this game signs in with. None of this is secret: a Firebase web API key only names the project,
 * and what protects it is the key's API and referrer restrictions plus deny-all Firestore rules (README, "Firebase").
 */
export const FIREBASE_PROJECT_ID = 'andershaf-87';
export const FIREBASE_WEB_CONFIG = {
  apiKey: 'AIzaSyDmK4ZmjGHZl4ImAoEAFLbQ5Vp1wkc0Wyk',
  authDomain: 'andershaf-87.firebaseapp.com',
  projectId: FIREBASE_PROJECT_ID,
  appId: '1:867594018708:web:4444ada96e29685f063981',
} as const;
