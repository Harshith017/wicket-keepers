// Sends training frames to the training pipeline, so nothing has to be exported by hand.
//
// Frames go to this site's own Firebase project (Firestore collection "ballFrames"), and a
// weekly scheduled job moves them to Roboflow, where the cricket-ball detector is retrained
// (see MODEL.md). Only people approved in the main Wicket Keepers app can send frames: the
// Firestore rules check that, so the tracker asks for the same Google sign-in once.
//
// Firebase is loaded only when this is switched on, so the tracker stays light otherwise.

const SDK = 'https://www.gstatic.com/firebasejs/10.13.2/';
const COLLECTION = 'ballFrames';
let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

/** Loads Firebase (app, sign-in, database) and this site's project settings, once. */
export function loadFirebase() {
  if (!loading) {
    loading = (async () => {
      if (!window.firebase || !window.firebase.firestore) {
        await loadScript(SDK + 'firebase-app-compat.js');
        await loadScript(SDK + 'firebase-auth-compat.js');
        await loadScript(SDK + 'firebase-firestore-compat.js');
      }
      if (!window.firebase.apps.length) await loadScript(new URL('../firebase-config.js', location.href).href);
      return window.firebase;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** The signed-in Google account's email, or null. Waits for Firebase to say. */
export async function signedInEmail() {
  const fb = await loadFirebase();
  return new Promise((resolve) => {
    const off = fb.auth().onAuthStateChanged((u) => { off(); resolve(u && u.email ? u.email : null); });
  });
}

/** Google sign-in (call from a tap: browsers only open the sign-in window then). */
export async function signIn() {
  const fb = await loadFirebase();
  const p = new fb.auth.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  const r = await fb.auth().signInWithPopup(p);
  return r.user && r.user.email;
}

export async function signOut() {
  const fb = await loadFirebase();
  await fb.auth().signOut();
}

/** A JPEG re-encoded smaller, as base64 (frames sit in the database until the weekly move). */
async function smallJpeg(blob, quality = 0.7) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  const small = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  const buf = new Uint8Array(await small.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Sends frames ([{ b, label, score, by, ball, name }]). Returns how many were stored.
 * Throws 'not-approved' if the rules refuse (the account is not approved in the main app).
 */
export async function sendFrames(samples) {
  if (!samples.length) return 0;
  const fb = await loadFirebase();
  const user = fb.auth().currentUser;
  if (!user) throw new Error('not-signed-in');
  const db = fb.firestore(), uid = user.uid;
  let sent = 0;
  for (const t of samples) {
    const img = await smallJpeg(t.b);
    if (img.length > 700000) continue;              // the rules refuse anything bigger
    try {
      await db.collection(COLLECTION).doc(`${uid.slice(0, 8)}-${t.name}`).set({
        img, label: t.label, score: t.score == null ? null : +t.score.toFixed(3), by: t.by,
        ball: t.ball, w: 640, uid, createdAt: fb.firestore.FieldValue.serverTimestamp(),
      });
      sent++;
    } catch (e) {
      if (e && e.code === 'permission-denied') throw new Error('not-approved');
      throw e;
    }
  }
  return sent;
}
