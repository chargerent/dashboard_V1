// Reuse the dashboard's signed-in Firebase account; imported only in hosted mode.
import {auth} from '../firebase-config.js';
export async function getDashboardIdToken(){await auth.authStateReady();if(!auth.currentUser)throw Object.assign(new Error('Sign in to the Client Dashboard, then reopen hosted Media Studio.'),{code:'MEDIA_AUTH_REQUIRED'});return auth.currentUser.getIdToken();}
