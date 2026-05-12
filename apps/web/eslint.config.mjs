// ESLint flat config for the web app.
//
// Replaces the legacy `.eslintrc.json` removed in this commit.
// Required because:
//   - ESLint 10 removed support for `.eslintrc.*` formats.
//   - Next.js 16 removed the bundled `next lint` command; we now
//     invoke `eslint` directly against the app sources.
//
// `eslint-config-next` ships a flat preset (`flat/core-web-vitals`)
// that combines @next/eslint-plugin-next + react-hooks rules. We
// extend it and re-apply the project-specific overrides that used
// to live in `.eslintrc.json`.

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "node_modules/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default config;
