import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReactConfig from "eslint-plugin-react/configs/recommended.js";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReactRefresh from "eslint-plugin-react-refresh";

export default [
  // -------------------------
  // Frontend (React/Vite)
  // -------------------------
  {
    files: ["**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: globals.browser,
    },
  },
  pluginJs.configs.recommended,
  {
    ...pluginReactConfig,
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
      "react-refresh": pluginReactRefresh,
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
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
];