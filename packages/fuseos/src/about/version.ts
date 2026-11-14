/**
 * The version the About sheet shows. Kept by hand next to packages/fuseos/package.json's
 * `version` (tests/fuseos-branding.test.ts checks the two agree) rather than imported from it,
 * so the package's tsconfig needs no JSON modules and the bundle no package manifest.
 */
export const FUSEOS_VERSION = "0.1.0";
