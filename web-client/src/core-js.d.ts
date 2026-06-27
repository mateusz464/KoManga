// core-js's deep entry points ship no type declarations; they are side-effect
// imports (polyfills), so an ambient module declaration is all TS needs.
declare module "core-js/stable/*";
