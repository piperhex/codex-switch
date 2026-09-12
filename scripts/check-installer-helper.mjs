import { buildInstallerHelper, helperHostTarget, runHelperCargo } from "./build-installer-helper.mjs";

// This crate uses Windows APIs directly; other platforms do not package it.
if (process.platform === "win32") {
  const target = helperHostTarget();
  for (const args of [
    ["fmt", "--", "--check"],
    ["clippy", "--locked", "--all-targets", "--target", target, "--", "-D", "warnings"],
    ["test", "--locked", "--target", target, "--", "--test-threads=1"],
  ]) {
    runHelperCargo(args, target);
  }
  buildInstallerHelper({ target, release: false });
}
