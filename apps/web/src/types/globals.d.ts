// Ambient declarations for side-effect asset imports.
//
// TypeScript 6 (TS2882) tightened module resolution and now requires
// an explicit declaration before `import "./globals.css"` and similar
// side-effect imports compile. Next.js handles the bundling of these
// at build time; we just need TS to accept the import statement.

declare module "*.css";
declare module "*.scss";
declare module "*.sass";
