// src/pages/LoginPage.jsx
import { useState } from "react";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { translations } from "../utils/translations";

import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase-config";
import { markStartupStep, measureStartupDuration, resetStartupTrace } from "../utils/startupTrace";

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

      const email = `${u}@${AUTH_MAPPING_DOMAIN}`;
      resetStartupTrace(`login:${u}`);
      markStartupStep("login.submit", { username: u });

      const signInStartedAt = performance.now();
      await signInWithEmailAndPassword(auth, email, password);
      markStartupStep("login.signIn.resolved", {
        durationMs: measureStartupDuration(signInStartedAt),
      });
      onLogin();
    } catch (err) {
      markStartupStep("login.error", {
        code: err?.code || "unknown",
        message: err?.message || t("login_error"),
      });
      // IMPORTANT: mask all errors as the same message
      setError(t("login_error"));
      setPassword("");
      setShowPassword(false);
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
            <div>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  className="appearance-none rounded-none relative block w-full rounded-b-md border border-gray-300 px-3 py-2 pr-11 placeholder-gray-500 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
                  placeholder={t("password")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 transition hover:text-gray-600 focus:outline-none focus:text-blue-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <EyeIcon className="h-5 w-5" aria-hidden="true" />
                  )}
                </button>
              </div>
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
