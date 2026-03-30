import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReactConfig from "eslint-plugin-react/configs/recommended.js";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    ignores: [
      "dist/**",
      "tmp/**",
      "src/utils/validators.js",
      "src/ajv-validators.js",
    ],
  },
  // -------------------------
  // Frontend (React/Vite)
  // -------------------------
  {
    files: ["src/**/*.{js,jsx}", "public/firebase-messaging-sw.js"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },
  pluginJs.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.{js,jsx}", "public/firebase-messaging-sw.js"],
    ...pluginReactConfig,
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...pluginReactConfig.rules,
      // This codebase does not maintain runtime PropTypes for React components.
      "react/prop-types": "off",
      // React 17+ with the automatic JSX runtime does not require importing React in every file.
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
    },
  },
  {
    files: ["src/**/*.{js,jsx}", "public/firebase-messaging-sw.js"],
    plugins: {
      "react-hooks": pluginReactHooks,
      "react-refresh": pluginReactRefresh,
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // These stricter compiler-oriented rules are too noisy for the current codebase.
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-refresh/only-export-components": "warn",
    },
  },

  // -------------------------
  // Backend (Firebase Functions - Node/CommonJS)
  // -------------------------
  {
    files: ["functions/**/*.{js,mjs,cjs}"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,   // ✅ module, require, exports, process, etc.
      },
    },
  },
  {
    files: [
      "scripts/**/*.{js,mjs,cjs}",
      "*.config.js",
      "compile-schemas.js",
    ],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["src/pages/compile-ajv-schemas.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
];
