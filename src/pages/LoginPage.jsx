// src/pages/LoginPage.jsx
import { useState } from "react";
import { translations } from "../utils/translations";

import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase-config";

// Change if you picked a different mapping domain
const AUTH_MAPPING_DOMAIN = "auth.charge.rent";

function LoginPage({ onLogin }) {
  const t = (key) => translations["en"][key] || key; // Login page defaults to English

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Keep usernames clean and predictable
  const normalizeUsername = (u) => String(u || "").trim().toLowerCase();

  // Basic allowlist to avoid weird characters creating weird emails
  const isValidUsername = (u) => /^[a-z0-9._-]+$/.test(u);

  const trackAttempt = httpsCallable(functions, "auth_trackAttempt");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const u = normalizeUsername(username);

      // Always fail generically (do not reveal why)
      if (!u || !isValidUsername(u)) {
        throw new Error(t("login_error"));
      }

      // 1) Check lockout BEFORE attempting auth
      const lockSnap = await getDoc(doc(db, "loginAttempts", u));
      if (lockSnap.exists()) {
        const lockData = lockSnap.data();
        if (lockData.lockedUntil && new Date(lockData.lockedUntil) > new Date()) {
          // Account is locked — always show generic error regardless of password
          trackAttempt({ username: u, success: false }).catch(() => {});
          throw new Error(t("login_error"));
        }
      }

      const email = `${u}@${AUTH_MAPPING_DOMAIN}`;

      // 2) Firebase Auth sign-in
      let cred;
      try {
        cred = await signInWithEmailAndPassword(auth, email, password);
      } catch (authErr) {
        // Track the failed attempt (fire-and-forget)
        trackAttempt({ username: u, success: false }).catch(() => {});
        throw authErr;
      }

      // 3) Get ID token
      const token = await cred.user.getIdToken();

      // 4) Load Firestore profile: users/{uid}
      const uid = cred.user.uid;
      const profileRef = doc(db, "users", uid);
      const snap = await getDoc(profileRef);

      if (!snap.exists()) {
        // If profile missing, treat as invalid login (do not reveal)
        trackAttempt({ username: u, success: false }).catch(() => {});
        throw new Error(t("login_error"));
      }

      const profile = snap.data();

      // Optional: enforce active flag (again, do not reveal)
      if (profile?.active === false) {
        trackAttempt({ username: u, success: false }).catch(() => {});
        throw new Error(t("login_error"));
      }

      // 5) Track successful login (fire-and-forget)
      trackAttempt({ username: u, success: true }).catch(() => {});

      // Hand back token + profile
      onLogin({ token, profile, uid });
    } catch (err) {
      // IMPORTANT: mask all errors as the same message
      setError(t("login_error"));
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <img
            className="mx-auto h-32 w-auto"
            src="/logo.png"
            alt="Company Logo"
            onError={(e) => {
              e.target.onerror = null;
              e.target.style.display = "none";
            }}
          />
          <h2 className="mt-6 text-center text-2xl font-extrabold text-gray-900">
            {t("login_title")}
          </h2>
        </div>

        <form className="mt-8 space-y-6 bg-white p-8 shadow-lg rounded-lg" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <input
                id="username"
                name="username"
                type="text"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder={t("username")}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder={t("password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(prev => !prev)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300"
            >
              {loading ? t("signing_in") : t("sign_in")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;