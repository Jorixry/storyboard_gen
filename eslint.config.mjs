import next from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Equivalent rule sources to eslint-config-next (which is pinned to ESLint ^9
// peers and therefore cannot be used with the currently supported ESLint 10):
// - typescript-eslint recommended  -> eslint-config-next/typescript
// - @next/eslint-plugin-next       -> Next.js rules (recommended + core-web-vitals)
// - eslint-plugin-react-hooks      -> rules-of-hooks / exhaustive-deps
// eslint-plugin-react and eslint-plugin-jsx-a11y are intentionally omitted:
// their current releases declare ESLint peer ranges capped at ^9.
const eslintConfig = tseslint.config(
  ...tseslint.configs.recommended,
  next.configs["core-web-vitals"],
  reactHooks.configs.flat.recommended,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "playwright-report/**",
      "test-results/**",
      "out/**",
      "next-env.d.ts",
    ],
  },
);

export default eslintConfig;
