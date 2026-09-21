import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/.next/**", "**/.next-demo/**", "**/legacy-solana/**", "**/generated/**", "**/node_modules/**", "**/.ponder/**"],
  },
  {
    rules: {
      // Spec §11: React's escaping is the main XSS defence, and every token name, ticker and
      // metadata field is attacker-controlled. One of these calls would undo it, so it is banned
      // outright rather than reviewed case by case.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            "Banned (spec §11): token metadata is attacker-controlled. Render it as text, or sanitise it in packages/shared and add an explicit exception here.",
        },
      ],
    },
  },
);
